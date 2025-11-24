import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { student_id } = req.body;
      
      await supabase
        .from('students')
        .update({ status: 'Normal' })
        .eq('student_id', student_id);

      await supabase
        .from('interventions')
        .update({ 
          status: 'Completed',
          completed_at: new Date().toISOString()
        })
        .eq('student_id', student_id)
        .is('completed_at', null);

      res.json({ success: true, status: 'Normal' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}