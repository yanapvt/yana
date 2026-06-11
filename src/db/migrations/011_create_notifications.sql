-- Migration: 011_create_notifications
-- Description: Create notifications table
-- Requirements: 16.2

-- Notifications (proactive and follow-up messaging)
CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(booking_id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL,
  notification_type VARCHAR(100) NOT NULL, -- reminder, check_in_alert, weather_update, traffic_update, etc.
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'scheduled', -- scheduled, sent, failed, cancelled
  content JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_booking_id ON notifications(booking_id);
CREATE INDEX idx_notifications_scheduled_at ON notifications(scheduled_at);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_notification_type ON notifications(notification_type);
