import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, StyleSheet, AppState, Image } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const supabase = createClient(
  'https://hogyeyaxnppdsbllrjve.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZ3lleWF4bnBwZHNibGxyanZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MDM5MDMsImV4cCI6MjA3OTM3OTkwM30._-IBymc0HBdoAbHB32b6LWxAHo2LswbD8vvCgAX-Rz4'
);

// API Configuration - Use environment variables for deployment
const API_BASE = process.env.REACT_APP_API_URL || 'https://alcovia-api.vercel.app/api';
const STUDENT_ID = 'demo_student_001';

// Alcovia brand colors
const BRAND_COLORS = {
  primary: '#6366f1',
  primaryDark: '#4f46e5',
  secondary: '#10b981',
  accent: '#f59e0b',
  danger: '#ef4444',
  background: '#0f172a',
  surface: '#1e293b',
  card: '#334155',
  textPrimary: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',
  border: '#475569',
};

// Custom logo component (professional fallback)
const AlcoviaLogo = () => (
  <View style={styles.logoSVG}>
    <Text style={styles.logoSVGText}>A</Text>
  </View>
);

export default function App() {
  const [studentStatus, setStudentStatus] = useState('Normal');
  const [focusTime, setFocusTime] = useState(0);
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [quizScore, setQuizScore] = useState('');
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [currentTask, setCurrentTask] = useState('');
  const [interventionId, setInterventionId] = useState(null);
  const [taskDescription, setTaskDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [usingRealtime, setUsingRealtime] = useState(false);
  const [showPenaltyMessage, setShowPenaltyMessage] = useState(false);
  
  const timerRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const statusCheckRef = useRef(null);

  // Fetch student status
  const fetchStudentStatus = async () => {
    try {
      console.log('📡 Fetching student status from:', `${API_BASE}/student-status/${STUDENT_ID}`);
      const response = await fetch(`${API_BASE}/student-status/${STUDENT_ID}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('✅ Status fetched:', data);
      setStudentStatus(data.status);
      setCurrentTask(data.task || '');
      setInterventionId(data.intervention_id || null);
      
      // NEW: If intervention exists, fetch the task description
      if (data.intervention_id) {
        await fetchTaskDescription(data.intervention_id);
      }
    } catch (error) {
      console.error('❌ Error fetching status:', error);
      // Fallback to mock data if API fails
      setStudentStatus('Normal');
      setCurrentTask('Complete daily learning modules');
      setInterventionId(null);
    }
  };

  // NEW: Fetch task description from Supabase
  const fetchTaskDescription = async (interventionId) => {
    try {
      console.log('📡 Fetching task description for intervention:', interventionId);
      
      const { data, error } = await supabase
        .from('interventions')
        .select('task_description')
        .eq('id', interventionId)
        .single();

      if (error) {
        throw error;
      }

      if (data && data.task_description) {
        console.log('✅ Task description fetched:', data.task_description);
        setTaskDescription(data.task_description);
      } else {
        console.log('⚠️ No task description found');
        setTaskDescription('Complete the assigned remedial work to continue your learning journey');
      }
    } catch (error) {
      console.error('❌ Error fetching task description:', error);
      setTaskDescription('Complete the assigned remedial work to continue your learning journey');
    }
  };

  // Real-time updates with WebSocket fallback to polling
  useEffect(() => {
    fetchStudentStatus(); // Initial fetch

    let subscription;
    let pollingInterval;

    try {
      // Try WebSocket realtime first
      subscription = supabase
        .channel('student-status')
        .on('postgres_changes', 
          { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'students',
            filter: `student_id=eq.${STUDENT_ID}`
          }, 
          (payload) => {
            console.log('🔔 Real-time WebSocket update:', payload.new);
            setStudentStatus(payload.new.status);
            fetchStudentStatus(); // Refresh to get task details
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Supabase realtime connected');
            setUsingRealtime(true);
            // Clear polling if WebSocket works
            if (pollingInterval) {
              clearInterval(pollingInterval);
            }
          }
        });

      // If WebSocket fails after 3 seconds, fallback to polling
      const fallbackTimeout = setTimeout(() => {
        if (!usingRealtime) {
          console.log('🔄 WebSocket failed, falling back to polling');
          pollingInterval = setInterval(fetchStudentStatus, 5000);
        }
      }, 3000);

      return () => {
        if (subscription) {
          subscription.unsubscribe();
        }
        if (pollingInterval) {
          clearInterval(pollingInterval);
        }
        clearTimeout(fallbackTimeout);
      };

    } catch (error) {
      console.error('❌ WebSocket error, using polling:', error);
      pollingInterval = setInterval(fetchStudentStatus, 5000);
      
      return () => {
        if (pollingInterval) {
          clearInterval(pollingInterval);
        }
      };
    }
  }, []);

  // Tab switch detection
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current === 'active' && 
          nextAppState.match(/inactive|background/) && 
          isTimerRunning) {
        handleTabSwitchPenalty();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isTimerRunning]);

  const handleTabSwitchPenalty = () => {
    // Show penalty message on screen
    setShowPenaltyMessage(true);
    
    // Hide the message after 5 seconds
    setTimeout(() => {
      setShowPenaltyMessage(false);
    }, 5000);
    
    // Show alert and submit penalty
    Alert.alert('Focus Session Failed', 'You switched away from the app!');
    handleDailyCheckin(true);
  };

  const startFocusTimer = () => {
    setIsTimerRunning(true);
    setFocusTime(0);
    setFocusSeconds(0);
    setShowPenaltyMessage(false); // Reset penalty message when starting new session
    
    timerRef.current = setInterval(() => {
      setFocusSeconds(prevSeconds => {
        const newSeconds = prevSeconds + 1;
        if (newSeconds === 60) {
          setFocusTime(prevMinutes => prevMinutes + 1);
          return 0;
        }
        return newSeconds;
      });
    }, 1000); // Update every second for live timer
  };

  const stopFocusTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsTimerRunning(false);
    setShowPenaltyMessage(false); // Reset penalty message when stopping timer
  };

  const formatTime = (minutes, seconds) => {
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDailyCheckin = async (penalty = false) => {
    setLoading(true);
    const finalScore = penalty ? 0 : parseInt(quizScore) || 0;
    const finalFocusTime = penalty ? 0 : focusTime;

    try {
      console.log('📤 Submitting check-in to:', `${API_BASE}/daily-checkin`);
      
      const response = await fetch(`${API_BASE}/daily-checkin`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          student_id: STUDENT_ID,
          quiz_score: finalScore,
          focus_minutes: finalFocusTime,
          penalty: penalty
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Check-in response:', result);
      
      setStudentStatus(result.status);
      
      // NEW: If we get an intervention ID from the check-in response, fetch the task description
      if (result.intervention_id) {
        setInterventionId(result.intervention_id);
        await fetchTaskDescription(result.intervention_id);
      }
      
      if (penalty) {
        stopFocusTimer();
      }
      
      Alert.alert('Check-in Submitted', result.message);
      
    } catch (error) {
      console.error('❌ Check-in error:', error);
      Alert.alert('Error', 'Failed to submit check-in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const completeRemedialTask = async () => {
    setLoading(true);
    try {
      console.log('📤 Completing remedial task:', `${API_BASE}/complete-remedial`);
      
      const response = await fetch(`${API_BASE}/complete-remedial`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ student_id: STUDENT_ID })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Remedial completion response:', result);
      
      if (result.success) {
        setStudentStatus('Normal');
        setCurrentTask('');
        setInterventionId(null);
        setTaskDescription(''); // NEW: Reset task description
        Alert.alert('Task Completed', 'You can now resume normal activities.');
      }
    } catch (error) {
      console.error('❌ Complete remedial error:', error);
      Alert.alert('Error', 'Failed to complete task. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetDemo = async () => {
    try {
      console.log('🔄 Resetting demo...');
      
      const response = await fetch(`${API_BASE}/complete-remedial`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ student_id: STUDENT_ID })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Reset response:', result);
      }
      
      // Always reset local state regardless of API response
      setStudentStatus('Normal');
      setCurrentTask('');
      setInterventionId(null);
      setTaskDescription(''); // NEW: Reset task description
      setQuizScore('');
      stopFocusTimer();
      setFocusTime(0);
      setFocusSeconds(0);
      setShowPenaltyMessage(false); // Reset penalty message
      
      Alert.alert('Demo Reset', 'Application has been reset to normal state.');
      
    } catch (error) {
      console.error('❌ Reset error:', error);
      // Still reset local state even if API fails
      setStudentStatus('Normal');
      setCurrentTask('');
      setInterventionId(null);
      setTaskDescription(''); // NEW: Reset task description
      setQuizScore('');
      stopFocusTimer();
      setFocusTime(0);
      setFocusSeconds(0);
      setShowPenaltyMessage(false); // Reset penalty message
      Alert.alert('Demo Reset', 'Application has been reset (local state only).');
    }
  };

  const getStatusColor = () => {
    switch(studentStatus) {
      case 'On Track': return BRAND_COLORS.secondary;
      case 'Needs Intervention': return BRAND_COLORS.accent;
      case 'Pending Mentor Review': return BRAND_COLORS.accent;
      case 'Remedial': return BRAND_COLORS.primary;
      default: return BRAND_COLORS.textSecondary;
    }
  };

  const getStatusIcon = () => {
    switch(studentStatus) {
      case 'On Track': return '🚀';
      case 'Needs Intervention': return '⚠️';
      case 'Pending Mentor Review': return '⏳';
      case 'Remedial': return '📚';
      default: return '🎯';
    }
  };

  // Penalty Message Component
  const PenaltyMessage = () => (
    <View style={styles.penaltyBanner}>
      <Text style={styles.penaltyIcon}>🚨</Text>
      <View style={styles.penaltyTextContainer}>
        <Text style={styles.penaltyTitle}>Focus Session Interrupted</Text>
        <Text style={styles.penaltyDescription}>
          You switched away from the app. Penalty has been imposed and assignment automatically submitted.
        </Text>
      </View>
    </View>
  );

  const renderNormalState = () => (
    <View style={styles.screen}>
      {/* Penalty Message Banner - Shows when user switches tabs */}
      {showPenaltyMessage && <PenaltyMessage />}
      
      <View style={styles.heroSection}>
        <Text style={styles.heroIcon}>🎯</Text>
        <Text style={styles.heroTitle}>Focus Mode</Text>
        <Text style={styles.heroSubtitle}>Start your daily learning session</Text>
      </View>
      
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Focus Timer</Text>
          <View style={styles.timerDisplay}>
            <Text style={styles.timerNumber}>
              {formatTime(focusTime, focusSeconds)}
            </Text>
            <Text style={styles.timerLabel}>
              {isTimerRunning ? '⏱️ Live Session' : 'Ready to Start'}
            </Text>
          </View>
        </View>
        
        <View style={styles.buttonGroup}>
          {!isTimerRunning ? (
            <TouchableOpacity 
              style={[styles.button, styles.primaryButton]} 
              onPress={startFocusTimer}
            >
              <Text style={styles.buttonText}>▶️ Start Focus Session</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={[styles.button, styles.dangerButton]} 
              onPress={stopFocusTimer}
            >
              <Text style={styles.buttonText}>⏹️ Stop Timer</Text>
            </TouchableOpacity>
          )}
        </View>

        {isTimerRunning && (
          <View style={styles.liveTimerIndicator}>
            <Text style={styles.liveTimerText}>
              🔴 Live - Session in progress: {focusTime}m {focusSeconds}s
            </Text>
            <Text style={styles.warningText}>
              ⚠️ Do not switch apps or you'll get a penalty!
            </Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily Assessment</Text>
        <Text style={styles.cardDescription}>
          Complete your daily quiz to track progress
        </Text>
        
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Quiz Score (0-10)</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your score"
            placeholderTextColor={BRAND_COLORS.textMuted}
            value={quizScore}
            onChangeText={setQuizScore}
            keyboardType="numeric"
            maxLength={2}
          />
        </View>

        <TouchableOpacity 
          style={[
            styles.button, 
            styles.primaryButton, 
            (loading || !quizScore) && styles.disabledButton
          ]} 
          onPress={() => handleDailyCheckin()}
          disabled={loading || !quizScore}
        >
          <Text style={styles.buttonText}>
            {loading ? '📤 Submitting...' : '📊 Submit Assessment'}
          </Text>
        </TouchableOpacity>

        <View style={styles.demoHint}>
          <Text style={styles.demoHintText}>
            💡 Demo: Score ≤7 triggers mentor review, Score ≤5 triggers remedial
          </Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>💡 Quick Guide</Text>
        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <Text style={styles.infoEmoji}>🎯</Text>
            <Text style={styles.infoText}>Score 8+ & 60+ mins</Text>
            <Text style={styles.infoSubtext}>Success Path</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoEmoji}>⚠️</Text>
            <Text style={styles.infoText}>Score 7- & 60- mins</Text>
            <Text style={styles.infoSubtext}>Mentor Review</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoEmoji}>🔒</Text>
            <Text style={styles.infoText}>Switch Apps</Text>
            <Text style={styles.infoSubtext}>Auto Penalty</Text>
          </View>
        </View>
        <Text style={styles.connectionBadge}>
          {usingRealtime ? '🔗 Live Updates' : '🔄 Polling Active'} • {API_BASE.includes('localhost') ? 'Local' : 'Production'}
        </Text>
      </View>

      <TouchableOpacity style={styles.resetButton} onPress={resetDemo}>
        <Text style={styles.resetButtonText}>🔄 Reset Session</Text>
      </TouchableOpacity>
    </View>
  );

  const renderLockedState = () => (
    <View style={[styles.screen, styles.lockedScreen]}>
      {/* Penalty Message Banner - Shows when user switches tabs */}
      {showPenaltyMessage && <PenaltyMessage />}
      
      <View style={styles.statusHeader}>
        <Text style={styles.statusIcon}>🔒</Text>
        <Text style={styles.statusTitle}>Under Review</Text>
        <Text style={styles.statusSubtitle}>Your progress is being analyzed</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '60%' }]} />
          </View>
          <Text style={styles.progressText}>Mentor Assignment Pending</Text>
        </View>

        <View style={styles.statusDetails}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Student ID</Text>
            <Text style={styles.detailValue}>{STUDENT_ID}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Current Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + '20' }]}>
              <Text style={[styles.statusBadgeText, { color: getStatusColor() }]}>
                {getStatusIcon()} {studentStatus}
              </Text>
            </View>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Intervention ID</Text>
            <Text style={styles.detailValue}>
              {interventionId || 'Not assigned'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>📧 Notification Sent</Text>
        <Text style={styles.infoText}>
          A mentor has been notified and will review your performance shortly. 
          You'll receive personalized guidance to help you get back on track.
        </Text>
        <Text style={styles.workflowInfo}>
          🔄 Waiting for mentor action via webhook...
        </Text>
      </View>

      <TouchableOpacity style={styles.resetButton} onPress={resetDemo}>
        <Text style={styles.resetButtonText}>🔄 Reset Demo</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRemedialState = () => (
    <View style={styles.screen}>
      {/* Penalty Message Banner - Shows when user switches tabs */}
      {showPenaltyMessage && <PenaltyMessage />}
      
      <View style={styles.heroSection}>
        <Text style={styles.heroIcon}>📚</Text>
        <Text style={styles.heroTitle}>Personalized Task</Text>
        <Text style={styles.heroSubtitle}>Your mentor has assigned a learning path</Text>
      </View>

      <View style={[styles.card, styles.taskCard]}>
        <View style={styles.taskHeader}>
          <Text style={styles.taskIcon}>🎯</Text>
          <View>
            <Text style={styles.taskTitle}>Assigned Learning Task</Text>
            <Text style={styles.taskSubtitle}>Tailored to your needs</Text>
          </View>
        </View>
        
        <View style={styles.taskContent}>
          <Text style={styles.taskDescription}>
            {/* UPDATED: Show actual task description from Supabase */}
            {taskDescription || currentTask}
          </Text>
        </View>

        {/* NEW: Show intervention details if available */}
        {interventionId && (
          <View style={styles.interventionDetails}>
            <Text style={styles.detailLabel}>Intervention ID: {interventionId}</Text>
          </View>
        )}

        <View style={styles.taskInstructions}>
          <Text style={styles.instructionsTitle}>Instructions:</Text>
          <Text style={styles.instructionsText}>
            • Complete all sections thoroughly{'\n'}
            • Take notes on key concepts{'\n'}
            • Be prepared for follow-up assessment{'\n'}
            • Click below when finished
          </Text>
        </View>

        <TouchableOpacity 
          style={[styles.button, styles.successButton, loading && styles.disabledButton]} 
          onPress={completeRemedialTask}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? '⏳ Completing...' : '✅ Mark Task Complete'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.connectionInfo}>
          {usingRealtime ? '🔗 Live Connection Active' : '🔄 Polling Updates Every 5s'} • {API_BASE.includes('localhost') ? 'Local' : 'Production'}
        </Text>
        {/* NEW: Show task source info */}
        {interventionId && (
          <Text style={styles.interventionInfo}>
            📋 Task loaded from Intervention ID: {interventionId}
          </Text>
        )}
      </View>

      <TouchableOpacity style={styles.resetButton} onPress={resetDemo}>
        <Text style={styles.resetButtonText}>🔄 Reset Session</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Image 
            source={{ uri: 'https://framerusercontent.com/images/IzMoibv1vcY7ioP3xoTVsaJIA.png' }} 
            style={styles.logoImage}
            resizeMode="contain"
            onError={() => console.log('Logo failed to load')}
          />
          
          <View>
            <Text style={styles.logoTitle}>ALCOVIA</Text>
            <Text style={styles.logoSubtitle}>Intervention Engine</Text>
          </View>
        </View>
        <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() + '20' }]}>
          <Text style={[styles.statusIndicatorText, { color: getStatusColor() }]}>
            {getStatusIcon()} {studentStatus}
          </Text>
        </View>
      </View>

      {studentStatus === 'Normal' || studentStatus === 'On Track' ? renderNormalState() :
       studentStatus === 'Needs Intervention' || studentStatus === 'Pending Mentor Review' ? renderLockedState() :
       studentStatus === 'Remedial' ? renderRemedialState() : renderNormalState()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND_COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: BRAND_COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoImage: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },
  logoSVG: {
    width:70,
    height: 70,
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BRAND_COLORS.primaryDark,
  },
  logoSVGText: {
    color: BRAND_COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  logoTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: BRAND_COLORS.textPrimary,
    letterSpacing: 1,
  },
  logoSubtitle: {
    fontSize: 12,
    color: BRAND_COLORS.textSecondary,
    fontWeight: '500',
  },
  statusIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
  },
  statusIndicatorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
    padding: 20,
    gap: 20,
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  heroIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: BRAND_COLORS.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    color: BRAND_COLORS.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: BRAND_COLORS.surface,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: BRAND_COLORS.textPrimary,
  },
  cardDescription: {
    fontSize: 14,
    color: BRAND_COLORS.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  timerDisplay: {
    alignItems: 'center',
  },
  timerNumber: {
    fontSize: 28,
    fontWeight: '700',
    color: BRAND_COLORS.primary,
    fontFamily: 'monospace',
  },
  timerLabel: {
    fontSize: 12,
    color: BRAND_COLORS.textSecondary,
    marginTop: 4,
  },
  buttonGroup: {
    gap: 12,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: BRAND_COLORS.primary,
  },
  successButton: {
    backgroundColor: BRAND_COLORS.secondary,
  },
  dangerButton: {
    backgroundColor: BRAND_COLORS.danger,
  },
  disabledButton: {
    backgroundColor: BRAND_COLORS.border,
    opacity: 0.6,
  },
  buttonText: {
    color: BRAND_COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: BRAND_COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: BRAND_COLORS.background,
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: BRAND_COLORS.textPrimary,
  },
  infoCard: {
    backgroundColor: BRAND_COLORS.surface,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND_COLORS.textPrimary,
    marginBottom: 12,
  },
  infoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  infoItem: {
    alignItems: 'center',
    flex: 1,
  },
  infoEmoji: {
    fontSize: 20,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 12,
    fontWeight: '500',
    color: BRAND_COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  infoSubtext: {
    fontSize: 10,
    color: BRAND_COLORS.textMuted,
    textAlign: 'center',
  },
  connectionBadge: {
    fontSize: 12,
    color: BRAND_COLORS.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  resetButton: {
    backgroundColor: BRAND_COLORS.card,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
  },
  resetButtonText: {
    color: BRAND_COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  lockedScreen: {
    backgroundColor: BRAND_COLORS.background,
    justifyContent: 'center',
  },
  statusHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  statusIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: BRAND_COLORS.textPrimary,
    marginBottom: 8,
  },
  statusSubtitle: {
    fontSize: 16,
    color: BRAND_COLORS.textSecondary,
    textAlign: 'center',
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressBar: {
    height: 8,
    backgroundColor: BRAND_COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: BRAND_COLORS.textSecondary,
    textAlign: 'center',
  },
  statusDetails: {
    gap: 16,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 14,
    color: BRAND_COLORS.textSecondary,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: BRAND_COLORS.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  taskCard: {
    borderLeftWidth: 4,
    borderLeftColor: BRAND_COLORS.primary,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  taskIcon: {
    fontSize: 24,
  },
  taskTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: BRAND_COLORS.textPrimary,
  },
  taskSubtitle: {
    fontSize: 14,
    color: BRAND_COLORS.textSecondary,
  },
  taskContent: {
    marginBottom: 20,
  },
  taskDescription: {
    fontSize: 16,
    color: BRAND_COLORS.textPrimary,
    lineHeight: 24,
  },
  taskInstructions: {
    backgroundColor: BRAND_COLORS.background,
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  instructionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: BRAND_COLORS.textPrimary,
    marginBottom: 8,
  },
  instructionsText: {
    fontSize: 13,
    color: BRAND_COLORS.textSecondary,
    lineHeight: 20,
  },
  connectionInfo: {
    fontSize: 12,
    color: BRAND_COLORS.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  liveTimerIndicator: {
    backgroundColor: BRAND_COLORS.primary + '20',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: BRAND_COLORS.primary,
  },
  liveTimerText: {
    fontSize: 12,
    color: BRAND_COLORS.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  warningText: {
    fontSize: 12,
    color: BRAND_COLORS.accent,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  demoHint: {
    backgroundColor: BRAND_COLORS.accent + '20',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: BRAND_COLORS.accent,
  },
  demoHintText: {
    fontSize: 12,
    color: BRAND_COLORS.accent,
    fontWeight: '500',
    textAlign: 'center',
  },
  workflowInfo: {
    fontSize: 12,
    color: BRAND_COLORS.primary,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  // NEW: Intervention details styles
  interventionDetails: {
    backgroundColor: BRAND_COLORS.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 2,
    borderLeftColor: BRAND_COLORS.secondary,
  },
  interventionInfo: {
    fontSize: 11,
    color: BRAND_COLORS.secondary,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  // Penalty Message Styles
  penaltyBanner: {
    backgroundColor: BRAND_COLORS.danger + '20',
    borderLeftWidth: 4,
    borderLeftColor: BRAND_COLORS.danger,
    padding: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  penaltyIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  penaltyTextContainer: {
    flex: 1,
  },
  penaltyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: BRAND_COLORS.danger,
    marginBottom: 4,
  },
  penaltyDescription: {
    fontSize: 14,
    color: BRAND_COLORS.textSecondary,
    lineHeight: 18,
  },
});