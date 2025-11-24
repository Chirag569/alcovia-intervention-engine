import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'https://alcovia-gamma.vercel.app',
    'https://alcovia-api.vercel.app',
    'http://localhost:19006',
    'http://localhost:8081', 
    'https://*.loca.lt',
    'https://*.ngrok.io',
    'https://*.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());

// Add fetch polyfill for Node.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Supabase configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ==================== ROUTES ====================

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🎉 Alcovia Intervention Engine API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/test - Test server connection',
      'GET /api/health - Health check',
      'POST /api/daily-checkin - Submit daily check-in',
      'POST /api/assign-intervention - Assign intervention (n8n)',
      'GET /api/assign-intervention - Assign intervention (email links)',
      'GET /api/student-status/:student_id - Get student status',
      'POST /api/complete-remedial - Complete remedial task'
    ],
    documentation: 'Visit /api/health for server status'
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is working!', 
    timestamp: new Date(),
    status: '✅ Operational'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Daily check-in endpoint - UPDATED with penalty information
app.post('/api/daily-checkin', async (req, res) => {
  const { student_id, quiz_score, focus_minutes, penalty } = req.body;
  
  console.log('📥 Received daily check-in:', { student_id, quiz_score, focus_minutes, penalty });

  // Validation
  if (!student_id || quiz_score === undefined || focus_minutes === undefined) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['student_id', 'quiz_score', 'focus_minutes']
    });
  }

  try {
    // First, ensure student exists
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*')
      .eq('student_id', student_id)
      .single();

    if (studentError && studentError.code === 'PGRST116') {
      console.log('👤 Creating new student:', student_id);
      // Student doesn't exist, create one
      const { data: newStudent, error: createError } = await supabase
        .from('students')
        .insert([{ student_id, status: 'Normal' }])
        .select()
        .single();
      
      if (createError) {
        console.error('❌ Error creating student:', createError);
        throw createError;
      }
      console.log('✅ Created new student');
    }

    // Insert daily log
    console.log('📝 Inserting daily log...');
    const { data: log, error: logError } = await supabase
      .from('daily_logs')
      .insert([{ student_id, quiz_score, focus_minutes }])
      .select()
      .single();

    if (logError) {
      console.error('❌ Error inserting daily log:', logError);
      throw logError;
    }
    console.log('✅ Daily log inserted');

    // Check conditions
    if (quiz_score > 7 && focus_minutes > 60) {
      console.log('🎯 Student is On Track');
      await supabase
        .from('students')
        .update({ status: 'On Track' })
        .eq('student_id', student_id);

      return res.json({ 
        status: "On Track",
        message: "Great job! Keep up the good work.",
        student_id,
        quiz_score,
        focus_minutes
      });
    } else {
      console.log('🚨 Student needs intervention');
      
      // SIMPLIFIED: Always create a new intervention for each submission
      const autoUnlockAt = new Date();
      autoUnlockAt.setHours(autoUnlockAt.getHours() + 12);

      const { data: intervention, error: interventionError } = await supabase
        .from('interventions')
        .insert([{ 
          student_id, 
          auto_unlock_at: autoUnlockAt.toISOString(),
          status: 'Pending'
        }])
        .select()
        .single();

      if (interventionError) {
        console.error('❌ Error creating intervention:', interventionError);
        throw interventionError;
      }
      
      console.log('✅ New intervention created:', intervention.id);

      // Update student status
      await supabase
        .from('students')
        .update({ status: 'Needs Intervention' })
        .eq('student_id', student_id);

      console.log('✅ Student status updated to Needs Intervention');

      // Trigger n8n webhook WITH intervention_id AND PENALTY INFORMATION
      if (process.env.N8N_WEBHOOK_URL) {
        console.log('🔄 Triggering n8n webhook with intervention_id:', intervention.id);
        try {
          const webhookPayload = { 
            student_id, 
            quiz_score, 
            focus_minutes,
            intervention_id: intervention.id,
            requires_intervention: true,
            timestamp: new Date().toISOString(),
            // ADDED: Penalty information for mentors
            penalty_imposed: penalty || false,
            penalty_reason: penalty ? 'Tab switching detected during focus session' : null,
            submission_type: penalty ? 'Auto-submitted due to penalty' : 'Manual submission',
            performance_issue: penalty ? 'Focus violation' : (quiz_score <= 7 ? 'Low quiz score' : 'Insufficient focus time')
          };
          
          console.log('📤 Sending to n8n:', JSON.stringify(webhookPayload, null, 2));
          
          const webhookResponse = await fetch(process.env.N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'User-Agent': 'Alcovia-Server/1.0'
            },
            body: JSON.stringify(webhookPayload)
          });
          
          if (webhookResponse.ok) {
            console.log('✅ n8n webhook triggered successfully with intervention_id:', intervention.id);
          } else {
            console.warn('⚠️ n8n webhook returned non-OK response:', webhookResponse.status);
          }
        } catch (webhookError) {
          console.error('❌ n8n webhook failed:', webhookError.message);
          // Don't throw error - n8n failure shouldn't break the main flow
        }
      } else {
        console.log('ℹ️ No n8n webhook URL set, skipping n8n trigger');
      }

      return res.json({ 
        status: "Pending Mentor Review",
        message: penalty ? 
          "Focus session interrupted! Your progress has been flagged for review." : 
          "Your progress is under review. A mentor will contact you soon.",
        student_id,
        quiz_score,
        focus_minutes,
        intervention_id: intervention.id,
        penalty_imposed: penalty || false
      });
    }
  } catch (error) {
    console.error('💥 Error in daily-checkin:', error);
    return res.status(500).json({ 
      error: error.message,
      details: 'Internal server error',
      student_id
    });
  }
});

// Assign intervention endpoint - POST (called by n8n)
app.post('/api/assign-intervention', async (req, res) => {
  const { student_id, task, intervention_id } = req.body;
  
  console.log('📨 POST Request - Intervention assignment:', { student_id, task, intervention_id });

  // Validation
  if (!student_id || !task || !intervention_id) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['student_id', 'task', 'intervention_id']
    });
  }

  try {
    // Update the specific intervention with task details
    const { error: interventionError } = await supabase
      .from('interventions')
      .update({ 
        task_description: task,
        mentor_approved: true,
        status: 'Assigned',
        assigned_at: new Date().toISOString()
      })
      .eq('id', intervention_id)
      .eq('student_id', student_id);

    if (interventionError) throw interventionError;

    // Update student status to Remedial
    const { error: studentError } = await supabase
      .from('students')
      .update({ status: 'Remedial' })
      .eq('student_id', student_id);

    if (studentError) throw studentError;

    console.log('✅ Intervention assigned successfully via POST for intervention_id:', intervention_id);
    res.json({ 
      success: true, 
      message: 'Intervention assigned successfully',
      student_id,
      task,
      intervention_id
    });
  } catch (error) {
    console.error('❌ Error assigning intervention via POST:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to assign intervention',
      student_id,
      intervention_id
    });
  }
});

// Assign intervention endpoint - GET (for email links)
app.get('/api/assign-intervention', async (req, res) => {
  const { student_id, task, intervention_id } = req.query;
  
  console.log('📧 GET Request - Intervention assignment via email:', { student_id, task, intervention_id });

  // Validation
  if (!student_id || !task || !intervention_id) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>❌ Missing Parameters - Alcovia</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #dc2626; font-size: 24px; }
          .info { color: #666; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="error">❌ Missing Required Parameters</div>
        <div class="info">Please check that all parameters are provided in the URL.</div>
        <div class="info">Required: student_id, task, intervention_id</div>
      </body>
      </html>
    `);
  }

  try {
    // Update the specific intervention with task details
    const { error: interventionError } = await supabase
      .from('interventions')
      .update({ 
        task_description: task,
        mentor_approved: true,
        status: 'Assigned',
        assigned_at: new Date().toISOString()
      })
      .eq('id', intervention_id)
      .eq('student_id', student_id);

    if (interventionError) {
      console.error('❌ Database error:', interventionError);
      throw interventionError;
    }

    // Update student status to Remedial
    const { error: studentError } = await supabase
      .from('students')
      .update({ status: 'Remedial' })
      .eq('student_id', student_id);

    if (studentError) throw studentError;

    console.log('✅ Intervention assigned successfully via GET for intervention_id:', intervention_id);
    
    // Return a nice HTML response for the mentor
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>✅ Task Assigned - Alcovia</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            margin: 0;
          }
          .container {
            background: white;
            color: #333;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            max-width: 500px;
            margin: 0 auto;
          }
          .success { 
            color: #059669; 
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 20px;
          }
          .info { 
            color: #666; 
            margin: 15px 0;
            line-height: 1.6;
          }
          .student-id {
            background: #f1f5f9;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            margin: 10px 0;
          }
          .task-box {
            background: #f0f9ff;
            border-left: 4px solid #2563eb;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
          }
          .intervention-id {
            background: #f0fdf4;
            border-left: 4px solid #10b981;
            padding: 10px;
            margin: 15px 0;
            text-align: left;
            font-family: monospace;
            font-size: 14px;
          }
          .button {
            background: #2563eb;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 8px;
            display: inline-block;
            margin-top: 20px;
            font-weight: bold;
          }
          .button:hover {
            background: #1d4ed8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div style="font-size: 48px; margin-bottom: 20px;">🎉</div>
          <div class="success">Task Assigned Successfully!</div>
          
          <div class="info">
            <strong>Student ID:</strong> 
            <div class="student-id">${student_id}</div>
          </div>
          
          <div class="info">
            <strong>Intervention ID:</strong>
            <div class="intervention-id">${intervention_id}</div>
          </div>
          
          <div class="info">
            <strong>Assigned Task:</strong>
            <div class="task-box">
              <strong>${task}</strong>
            </div>
          </div>
          
          <div class="info">
            The student will see this task immediately and can begin working on it.
            The intervention system will track their progress automatically.
          </div>
          
          <a href="http://localhost:19006" class="button">View Student App</a>
          <br>
          <a href="https://alcovia-intervention.app.n8n.cloud" class="button" style="background: #666; margin-top: 10px;">Back to n8n Dashboard</a>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Error assigning intervention via GET:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>❌ Error - Alcovia</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #fef2f2;
          }
          .error { 
            color: #dc2626; 
            font-size: 24px;
            font-weight: bold;
          }
          .details {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: left;
            border-left: 4px solid #dc2626;
          }
        </style>
      </head>
      <body>
        <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
        <div class="error">Error Assigning Task</div>
        <div class="details">
          <strong>Error Details:</strong><br>
          ${error.message}
        </div>
        <p>Please try again or contact the Alcovia support team.</p>
        <a href="https://alcovia-intervention.app.n8n.cloud" style="color: #2563eb;">Back to n8n Dashboard</a>
      </body>
      </html>
    `);
  }
});

// Get student status
app.get('/api/student-status/:student_id', async (req, res) => {
  const { student_id } = req.params;
  
  console.log('🔍 Getting status for student:', student_id);

  try {
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*')
      .eq('student_id', student_id)
      .single();

    if (studentError) throw studentError;

    const { data: intervention, error: interventionError } = await supabase
      .from('interventions')
      .select('*')
      .eq('student_id', student_id)
      .is('completed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Auto-unlock check
    if (intervention && intervention.auto_unlock_at && new Date() > new Date(intervention.auto_unlock_at)) {
      console.log('🔓 Auto-unlocking student (12-hour timeout)');
      await supabase
        .from('students')
        .update({ status: 'Normal' })
        .eq('student_id', student_id);

      student.status = 'Normal';
    }

    const response = {
      status: student.status,
      task: intervention?.task_description,
      intervention_id: intervention?.id,
      student_id
    };

    console.log('✅ Student status retrieved:', response);
    res.json(response);
  } catch (error) {
    console.error('❌ Error getting student status:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to get student status',
      student_id
    });
  }
});

// Complete remedial task
app.post('/api/complete-remedial', async (req, res) => {
  const { student_id } = req.body;
  
  console.log('✅ Completing remedial task for:', student_id);

  if (!student_id) {
    return res.status(400).json({
      error: 'Missing student_id'
    });
  }

  try {
    // Update student status to Normal
    const { error: studentError } = await supabase
      .from('students')
      .update({ status: 'Normal' })
      .eq('student_id', student_id);

    if (studentError) throw studentError;

    // Mark intervention as completed
    const { error: interventionError } = await supabase
      .from('interventions')
      .update({ 
        status: 'Completed',
        completed_at: new Date().toISOString()
      })
      .eq('student_id', student_id)
      .is('completed_at', null);

    if (interventionError) throw interventionError;

    console.log('✅ Remedial task completed for student:', student_id);
    res.json({ 
      success: true, 
      status: 'Normal',
      message: 'Task completed successfully',
      student_id
    });
  } catch (error) {
    console.error('❌ Error completing remedial task:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to complete task',
      student_id
    });
  }
});

// 404 handler - MUST BE LAST
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableEndpoints: [
      'GET /',
      'GET /api/test',
      'GET /api/health', 
      'POST /api/daily-checkin',
      'POST /api/assign-intervention',
      'GET /api/assign-intervention',
      'GET /api/student-status/:student_id',
      'POST /api/complete-remedial'
    ]
  });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`\n🎉 ==========================================`);
  console.log(`🚀 Alcovia Intervention Engine Started!`);
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log(`📊 API Base URL: http://localhost:${PORT}/api`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🎉 Root endpoint: http://localhost:${PORT}/`);
  console.log(`==========================================\n`);
  
  // Environment checks
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('⚠️  Supabase environment variables not set!');
  } else {
    console.log('✅ Supabase credentials loaded');
  }
  
  if (!process.env.N8N_WEBHOOK_URL) {
    console.log('ℹ️  n8n webhook URL not set - n8n features disabled');
  } else {
    console.log('✅ n8n webhook URL loaded');
  }
  
  console.log(`\n📋 Ready for testing!`);
  console.log(`🔗 GET endpoint available for email links: http://localhost:${PORT}/api/assign-intervention`);
  console.log(`📧 Use this for n8n email template links!\n`);
});