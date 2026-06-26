import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { config } from '../config/env';
import { useAuth } from '../contexts/AuthContext';

const TYPE_ICONS = {
  friend_request: '👤',
  battle_invite: '⚔️',
  comment_reply: '💬',
  game_vote: '👍',
  badge_earned: '🏆',
  jam_invite: '🎮',
  system: '📢',
};

export default function NotificationBell() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${config.backend_url}/api/notifications/in-app`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error('Failed to fetch notifications');
    }
  }, [token]);

  // Fetch on mount and poll every 30s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Fetch unread count more frequently
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${config.backend_url}/api/notifications/in-app/count`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setUnreadCount(data.count || 0);
      } catch (e) {}
    }, 15000);
    return () => clearInterval(interval);
  }, [token]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') setOpen(false); }
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const markAllRead = async () => {
    try {
      await fetch(`${config.backend_url}/api/notifications/in-app/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
      setUnreadCount(0);
    } catch (e) {}
  };

  const markOneRead = async (id) => {
    try {
      await fetch(`${config.backend_url}/api/notifications/in-app/${id}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {}
  };

  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  if (!token) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center px-2 py-2 rounded-lg text-surface-300 hover:text-white hover:bg-surface-800/60 transition-all"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-accent-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 border border-surface-700 rounded-xl shadow-2xl overflow-hidden z-[100]"
            style={{ backgroundColor: '#0a0a0f', opacity: 1 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800" style={{ backgroundColor: '#0a0a0f' }}>
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-primary-400 hover:text-primary-300 transition-colors flex items-center gap-1">
                    <CheckCheck className="h-3 w-3" /> Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-surface-500 hover:text-white transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto" style={{ backgroundColor: '#0a0a0f' }}>
              {notifications.length === 0 ? (
                <div className="py-8 text-center" style={{ backgroundColor: '#0a0a0f' }}>
                  <Bell className="h-8 w-8 text-surface-700 mx-auto mb-2" />
                  <p className="text-xs text-surface-500">No notifications yet</p>
                </div>
              ) : (
                notifications.slice(0, 15).map(n => (
                  <div
                    key={n.id}
                    className="flex items-start gap-3 px-4 py-3 border-b border-surface-800/50 hover:bg-surface-800 transition-colors cursor-pointer"
                    style={{ backgroundColor: !n.read ? '#0d0d14' : '#0a0a0f' }}
                    onClick={() => {
                      if (!n.read) markOneRead(n.id);
                      if (n.link) { setOpen(false); window.location.href = n.link; }
                    }}
                  >
                    <span className="text-lg flex-shrink-0 mt-0.5">{TYPE_ICONS[n.type] || '📢'}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-relaxed ${!n.read ? 'text-white font-medium' : 'text-surface-400'}`}>
                        {n.title}
                      </p>
                      {n.message && <p className="text-[10px] text-surface-500 mt-0.5 truncate">{n.message}</p>}
                      <span className="text-[10px] text-surface-600">{timeAgo(n.created_at)}</span>
                    </div>
                    {!n.read && <div className="w-2 h-2 rounded-full bg-primary-400 flex-shrink-0 mt-1.5" />}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
