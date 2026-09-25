import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Logo from '../../components/Logo';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Search,
  Code2,
  Smile,
  MoreVertical,
  Flag,
  Ban,
  Pencil,
  Check,
  X,
  Plus,
  UserPlus,
  LogOut,
  Trash2,
  SmilePlus
} from 'lucide-react';

// Dynamic import to avoid SSR issues with emoji picker
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });
import { useAuth } from '../../contexts/AuthContext';
import { useMessaging } from '../../contexts/MessagingContext';
import { useChallenge } from '../../contexts/ChallengeContext';
import { useFriends } from '../../contexts/FriendContext';
import { withAuth } from '../../components/withAuth';
import Button from '../../components/ui/Button';
import ReportUserModal, { BlockUserModal } from '../../components/ReportUserModal';
import { trackViewMessages, trackMessageSent, trackConversationOpened } from '../../utils/analytics';
import AvatarDisplay from '../../components/ui/AvatarDisplay';
import { formatMessageTime as formatTime, formatActiveStatus } from '../../utils/formatting';
import { config } from '../../config/env';
import { splitTextIntoSafeLinkParts } from '../../utils/safeLinks';

const MESSAGE_REACTION_OPTIONS = [
  { emoji: '\uD83D\uDC4D', label: 'Thumbs up' },
  { emoji: '\u2764\uFE0F', label: 'Heart' },
  { emoji: '\uD83D\uDE02', label: 'Laugh' },
  { emoji: '\uD83D\uDD25', label: 'Fire' },
  { emoji: '\uD83D\uDC4F', label: 'Clap' },
  { emoji: '\uD83D\uDE2E', label: 'Surprised' }
];

// Conversations are noisy if every message stamps a clock. Only show a stamp
// when this message starts a new "burst" \u2014 different sender than the previous
// message, or more than this many milliseconds since the previous one.
const TIMESTAMP_BURST_GAP_MS = 5 * 60 * 1000;

const formatChatTimestamp = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (isSameDay) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
};

const formatFullTimestamp = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const formatDateSeparator = (dateString) => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: now.getFullYear() === date.getFullYear() ? undefined : 'numeric' });
};

// Returns whether the row at `idx` should show a visible timestamp underneath.
// Bursts are sender-bound: switching speakers always restarts a burst, and
// a same-sender gap > TIMESTAMP_BURST_GAP_MS also does.
const shouldShowTimestamp = (messages, idx) => {
  const curr = messages[idx];
  const next = messages[idx + 1];
  if (!curr) return false;
  if (!next) return true; // last message in the list always shows time
  if (next.sender_id !== curr.sender_id) return true;
  const dt = new Date(next.created_at).getTime() - new Date(curr.created_at).getTime();
  return !Number.isFinite(dt) || dt > TIMESTAMP_BURST_GAP_MS;
};

// Returns whether the row at `idx` is the FIRST message of a burst: i.e. a
// new sender starts speaking, more than TIMESTAMP_BURST_GAP_MS has elapsed
// since the last message, or this is the first message in the list. Drives
// whether the sender's name header is rendered above this bubble in group
// chats (option 2 in the design comparison).
const isFirstOfBurst = (messages, idx) => {
  if (idx === 0) return true;
  const prev = messages[idx - 1];
  const curr = messages[idx];
  if (!prev || !curr) return true;
  if (prev.sender_id !== curr.sender_id) return true;
  const dt = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
  return !Number.isFinite(dt) || dt > TIMESTAMP_BURST_GAP_MS;
};

const shouldShowDateSeparator = (messages, idx) => {
  if (idx === 0) return true;
  const prev = messages[idx - 1];
  const curr = messages[idx];
  if (!prev || !curr) return false;
  const a = new Date(prev.created_at);
  const b = new Date(curr.created_at);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.toDateString() !== b.toDateString();
};

function DateSeparator({ dateString }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-white/10" />
      <span className="text-[11px] uppercase tracking-wide text-surface-400">
        {formatDateSeparator(dateString)}
      </span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

// Popover that opens when the user clicks the "+" reaction trigger.
// Dismisses on outside click and Esc; arrow keys move between options.
function MessageReactionPicker({ open, onClose, onPick, anchorSide = 'right' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer the listener install one frame so the same click that opens the
    // popover doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={containerRef}
          role="dialog"
          aria-label="Pick a reaction"
          initial={{ opacity: 0, scale: 0.85, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: 6 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className={`absolute bottom-full mb-2 z-20 flex items-center gap-1 rounded-full border border-white/15 bg-surface-900/95 p-1 shadow-2xl backdrop-blur ${
            anchorSide === 'right' ? 'right-0' : 'left-0'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {MESSAGE_REACTION_OPTIONS.map((option) => (
            <button
              key={option.emoji}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPick(option.emoji);
                onClose();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-base transition-transform hover:scale-125 hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-white/30"
              aria-label={`React with ${option.label}`}
              title={option.label}
            >
              {option.emoji}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Human-readable list of who reacted with a given emoji. Uses the viewer's
// own username to surface "You" first, mirrors how iMessage / Slack format
// reactor lists. Falls back to a count if no users are attached.
function formatReactorsTooltip(reaction, viewerUsername) {
  const users = Array.isArray(reaction.users) ? reaction.users : [];
  if (users.length === 0) {
    return `${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}`;
  }
  const names = users.map((u) =>
    viewerUsername && u.username === viewerUsername ? 'You' : u.username
  );
  // Move "You" to the front for clarity.
  names.sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0));
  const verb = users.length === 1 ? 'reacted' : 'reacted';
  if (names.length <= 3) return `${names.join(', ')} ${verb} with ${reaction.emoji}`;
  const head = names.slice(0, 2).join(', ');
  return `${head} and ${names.length - 2} others ${verb} with ${reaction.emoji}`;
}

// Tooltip body listing every user who reacted with a given emoji. Surfaces
// the viewer first as "You" if they reacted, otherwise lists names in the
// order they reacted. Shows on hover/focus.
function ReactionUsersTooltip({ reaction, viewerUsername }) {
  const users = Array.isArray(reaction.users) ? reaction.users : [];
  if (users.length === 0) return null;
  const names = users.map((u) =>
    viewerUsername && u.username === viewerUsername ? 'You' : u.username
  );
  names.sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0));

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-surface-950/95 px-2.5 py-1.5 text-[11px] text-white shadow-xl opacity-0 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 transition-opacity"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">{reaction.emoji}</span>
        <span className="font-medium">{names.slice(0, 5).join(', ')}{names.length > 5 ? `, +${names.length - 5} more` : ''}</span>
      </div>
      <span className="block text-[10px] text-surface-400 mt-0.5">
        {reaction.reacted_by_me ? 'Click to remove yours' : 'Click to react'}
      </span>
    </div>
  );
}

// Persistent footer row below a message bubble. Renders one chip per emoji
// that has at least one reaction, plus the picker trigger.
function MessageReactions({ reactions = [], isOwn, onToggle, viewerUsername }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const visibleReactions = reactions.filter((r) => r.count > 0);

  return (
    <div className={`mt-1 flex flex-wrap items-center gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      {visibleReactions.map((reaction) => (
        <div key={reaction.emoji} className="relative group/chip">
          <motion.button
            type="button"
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(reaction.emoji);
            }}
            className={`flex h-6 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium transition-colors ${
              reaction.reacted_by_me
                ? 'border-primary-300/70 bg-primary-400/25 text-white'
                : 'border-white/10 bg-surface-900/70 text-surface-200 hover:bg-white/10'
            }`}
            aria-label={formatReactorsTooltip(reaction, viewerUsername)}
            aria-pressed={!!reaction.reacted_by_me}
          >
            <span className="text-sm leading-none">{reaction.emoji}</span>
            <span>{reaction.count}</span>
          </motion.button>
          <ReactionUsersTooltip reaction={reaction} viewerUsername={viewerUsername} />
        </div>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((v) => !v);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-surface-900/70 text-surface-300 transition-all hover:bg-white/10 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 sm:opacity-0 sm:group-hover:opacity-100"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label="Add reaction"
          title="Add reaction"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
        <MessageReactionPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={onToggle}
          anchorSide={isOwn ? 'right' : 'left'}
        />
      </div>
    </div>
  );
}

function MessagesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { friends, isFriend } = useFriends();
  const {
    connected,
    conversations,
    activeChat,
    messages,
    typingUsers,
    fetchConversations,
    sendMessage,
    toggleMessageReaction,
    deleteMessage,
    startTyping,
    stopTyping,
    openChat,
    closeChat,
    setMessages,
    // Group chat
    groupConversations,
    activeGroupChat,
    groupMessages,
    setGroupMessages,
    groupTypingUsers,
    fetchGroupConversations,
    createGroup,
    sendGroupMessage,
    toggleGroupMessageReaction,
    deleteGroupMessage,
    startGroupTyping,
    stopGroupTyping,
    openGroupChat,
    closeGroupChat,
    leaveGroup,
    addGroupMember,
    deleteGroup
  } = useMessaging();
  const { sendChallenge } = useChallenge();

  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeSent, setChallengeSent] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // Group message edit state
  const [editingGroupMessageId, setEditingGroupMessageId] = useState(null);
  const [editGroupContent, setEditGroupContent] = useState('');
  const [editGroupSaving, setEditGroupSaving] = useState(false);
  // Group chat state
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const messagesEndRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const moreMenuRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Convert URLs in text to clickable links
  const linkify = (text) => {
    return splitTextIntoSafeLinkParts(text).map((part, index) => {
      if (part.type === 'link') {
        return (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        );
      }
      return part.text;
    });
  };

  // Handle copying message text
  const handleCopyMessage = async (messageId, content) => {
    if (!content) return; // nothing to copy (e.g. deleted message)
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, groupMessages]);

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Track page view
  useEffect(() => {
    trackViewMessages({
      conversationCount: conversations.length
    }, user);
  }, [user, conversations.length]);

  const openedRouteUserRef = useRef(null);
  // Apply a deep link once per URL change. A later sidebar selection must not
  // reopen the original deep link (including while its replacement is loading).
  useEffect(() => {
    const userId = router.query.userId;
    if (!userId) {
      openedRouteUserRef.current = null;
      return;
    }
    const parsedUserId = Number(userId);
    if (connected && Number.isSafeInteger(parsedUserId) && parsedUserId > 0 && openedRouteUserRef.current !== parsedUserId) {
      openedRouteUserRef.current = parsedUserId;
      openChat(parsedUserId);
    }
  }, [router.query.userId, connected, openChat]);

  const handleSend = async () => {
    if (!messageInput.trim() || !activeChat || sending) return;

    setSending(true);
    const msgContent = messageInput.trim();
    const success = sendMessage(activeChat.id, msgContent);
    if (success) {
      trackMessageSent({
        recipientId: activeChat.id,
        messageLength: msgContent.length
      }, user);
      setMessageInput('');
      stopTyping(activeChat.id);
    }
    setSending(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setMessageInput(e.target.value);
    if (activeChat) {
      startTyping(activeChat.id);
    }
  };

  const handleEmojiClick = (emojiData) => {
    setMessageInput(prev => prev + emojiData.emoji);
    inputRef.current?.focus();
  };

  const handleToggleMessageReaction = (messageId, emoji) => {
    toggleMessageReaction(messageId, emoji);
  };

  const handleToggleGroupMessageReaction = (messageId, emoji) => {
    toggleGroupMessageReaction(messageId, emoji);
  };

  // Close emoji picker and more menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setShowMoreMenu(false);
      }
    };

    if (showEmojiPicker || showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker, showMoreMenu]);

  // Handle block success - close chat and refresh conversations
  const handleBlocked = () => {
    closeChat();
    fetchConversations();
  };

  // Check if message is editable (within 15 minutes, like WhatsApp)
  const isMessageEditable = (msg) => {
    if (msg.sender_id !== user?.id) return false;
    const createdAt = new Date(msg.created_at);
    const now = new Date();
    const fifteenMinInMs = 15 * 60 * 1000;
    return (now - createdAt) < fifteenMinInMs;
  };

  // Start editing a message
  const handleStartEdit = (msg) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  // Save edited message
  const handleSaveEdit = async (messageId) => {
    if (!editContent.trim() || editSaving) return;

    setEditSaving(true);
    try {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const res = await fetch(`${config.backend_url}/api/messages/edit/${messageId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: editContent.trim() })
      });

      const data = await res.json();
      if (data.success) {
        // Update message in local state
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, content: editContent.trim(), edited_at: data.message.edited_at }
            : m
        ));
        setEditingMessageId(null);
        setEditContent('');
      } else {
        alert(data.error || 'Failed to edit message');
      }
    } catch (err) {
      console.error('Error editing message:', err);
      alert('Failed to edit message');
    } finally {
      setEditSaving(false);
    }
  };

  // Delete own message. State updates arrive via the 'message-deleted' socket event.
  const handleDeleteMessage = (messageId) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
    deleteMessage(messageId);
  };

  // Check if group message is editable (within 15 minutes)
  const isGroupMessageEditable = (msg) => {
    if (msg.sender_id !== user?.id) return false;
    const createdAt = new Date(msg.created_at);
    const now = new Date();
    const fifteenMinInMs = 15 * 60 * 1000;
    return (now - createdAt) < fifteenMinInMs;
  };

  // Start editing a group message
  const handleStartGroupEdit = (msg) => {
    setEditingGroupMessageId(msg.id);
    setEditGroupContent(msg.content);
  };

  // Cancel editing group message
  const handleCancelGroupEdit = () => {
    setEditingGroupMessageId(null);
    setEditGroupContent('');
  };

  // Save edited group message
  const handleSaveGroupEdit = async (messageId) => {
    if (!editGroupContent.trim() || editGroupSaving || !activeGroupChat) return;

    setEditGroupSaving(true);
    try {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const res = await fetch(`${config.backend_url}/api/messages/groups/${activeGroupChat.id}/messages/${messageId}/edit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: editGroupContent.trim() })
      });

      const data = await res.json();
      if (data.success) {
        // Update message in local state via context
        setGroupMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, content: editGroupContent.trim(), edited_at: data.message.edited_at }
            : m
        ));
        setEditingGroupMessageId(null);
        setEditGroupContent('');
      } else {
        alert(data.error || 'Failed to edit message');
      }
    } catch (err) {
      console.error('Error editing group message:', err);
      alert('Failed to edit message');
    } finally {
      setEditGroupSaving(false);
    }
  };

  // Delete own group message. State updates arrive via the 'group-message-deleted' socket event.
  const handleDeleteGroupMessage = (messageId) => {
    if (!activeGroupChat) return;
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
    deleteGroupMessage(activeGroupChat.id, messageId);
  };

  const isTyping = activeChat && typingUsers.has(activeChat.id);
  const isGroupTyping = activeGroupChat && groupTypingUsers.get(activeGroupChat.id)?.size > 0;

  // Group chat handlers
  const handleSendGroupMessage = async () => {
    if (!messageInput.trim() || !activeGroupChat || sending) return;

    setSending(true);
    const success = sendGroupMessage(activeGroupChat.id, messageInput.trim());
    if (success) {
      setMessageInput('');
      stopGroupTyping(activeGroupChat.id);
    }
    setSending(false);
  };

  const handleGroupInputChange = (e) => {
    setMessageInput(e.target.value);
    if (activeGroupChat) {
      startGroupTyping(activeGroupChat.id);
    }
  };

  const closeCreateGroupModal = () => {
    setShowCreateGroupModal(false);
    setNewGroupName('');
    setSelectedGroupMemberIds([]);
  };

  const toggleGroupMemberSelection = (friendId) => {
    setSelectedGroupMemberIds(prev => {
      if (prev.includes(friendId)) {
        return prev.filter(id => id !== friendId);
      }
      if (prev.length >= 9) {
        return prev;
      }
      return [...prev, friendId];
    });
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || creatingGroup) return;

    setCreatingGroup(true);
    try {
      const group = await createGroup(newGroupName.trim(), selectedGroupMemberIds);
      closeCreateGroupModal();
      // Open the newly created group
      openGroupChat(group.id);
    } catch (err) {
      alert(err.message || 'Failed to create group');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!activeGroupChat) return;
    if (!confirm(`Are you sure you want to leave "${activeGroupChat.name}"?`)) return;

    try {
      await leaveGroup(activeGroupChat.id);
    } catch (err) {
      alert(err.message || 'Failed to leave group');
    }
  };

  const handleDeleteGroup = async () => {
    if (!activeGroupChat) return;
    if (!confirm(`Are you sure you want to DELETE "${activeGroupChat.name}"? This will remove all messages and cannot be undone.`)) return;

    try {
      await deleteGroup(activeGroupChat.id);
    } catch (err) {
      alert(err.message || 'Failed to delete group');
    }
  };

  // Check if current user is the group creator (compare as numbers to avoid type mismatch)
  const isGroupCreator = activeGroupChat?.creator_id && user?.id &&
    Number(activeGroupChat.creator_id) === Number(user.id);

  // Create unified conversation list (direct + groups merged and sorted by activity)
  const unifiedConversations = React.useMemo(() => {
    const directChats = conversations.map(conv => ({
      type: 'direct',
      id: conv.other_user_id,
      name: conv.other_username,
      avatar: conv.other_avatar || 'default-1',
      avatar_url: conv.other_avatar_url,
      isOnline: !!conv.other_online,
      lastMessageTime: conv.last_message_time,
      lastMessageContent: conv.last_message_content,
      lastMessageSenderId: conv.last_message_sender_id,
      unreadCount: conv.unread_count || 0
    }));

    const groupChats = groupConversations.map(group => ({
      type: 'group',
      id: group.id,
      name: group.name,
      avatar: group.avatar || '',
      memberCount: group.member_count || 1,
      lastMessageTime: group.last_message_time || group.last_activity,
      lastMessageContent: group.last_message_content,
      lastMessageSenderUsername: group.last_message_sender_username,
      unreadCount: group.unread_count || 0
    }));

    // Merge and sort by last message time (most recent first)
    return [...directChats, ...groupChats].sort((a, b) => {
      const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return timeB - timeA;
    });
  }, [conversations, groupConversations]);

  // Handle conversation click (direct or group)
  const handleConversationClick = (conv) => {
    setChallengeSent(false);
    if (conv.type === 'direct') {
      closeGroupChat();
      openChat(conv.id);
    } else {
      closeChat();
      openGroupChat(conv.id);
    }
  };

  // Search for users to add to group (debounced)
  const handleMemberSearch = (query) => {
    setMemberSearchQuery(query);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query.trim()) {
      setMemberSearchResults([]);
      setSearchingMembers(false);
      return;
    }

    // Show loading indicator immediately
    setSearchingMembers(true);

    // Debounce: wait 300ms after user stops typing
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
        const res = await fetch(`${config.backend_url}/api/users/search?q=${encodeURIComponent(query)}&limit=10`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          // Filter to friends only (backend requires friendship) and exclude current members
          const currentMemberIds = activeGroupChat?.members?.map(m => m.user_id) || [];
          const filtered = data.users.filter(u => !currentMemberIds.includes(u.id) && isFriend(u.id));
          setMemberSearchResults(filtered);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearchingMembers(false);
      }
    }, 300);
  };

  // Add member to group
  const handleAddMember = async (userId) => {
    if (!activeGroupChat || addingMember) return;

    setAddingMember(true);
    try {
      await addGroupMember(activeGroupChat.id, userId);
      // Refresh the group to get updated members list
      await openGroupChat(activeGroupChat.id);
      // Remove from search results
      setMemberSearchResults(prev => prev.filter(u => u.id !== userId));
    } catch (err) {
      alert(err.message || 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  return (
    <>
      <Head>
        <title>Messages - CodeArena</title>
      </Head>

      <div className="min-h-screen bg-surface-950 text-white">
        {/* App-level header: page identity only. The recipient / group
            info lives in a dedicated thread bar inside the chat panel
            (design option B). This keeps the brand + page name visually
            separate from "who you're talking to" instead of stacking them
            into one bar where they competed for emphasis. */}
        <header className="bg-surface-900 border-b border-surface-800 px-6 py-4 sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Logo />
            </Link>
            <h1 className="text-lg font-semibold flex items-center space-x-2">
              <MessageSquare className="h-5 w-5 text-primary-400" />
              <span>Messages</span>
            </h1>
            <div className="flex items-center space-x-3">
              {!connected && (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Loader2 className="h-5 w-5 text-warning" title="Connecting..." />
                </motion.div>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto flex h-[calc(100vh-73px)]">
          {/* Conversations List */}
          <div className={`w-full md:w-80 border-r border-surface-800 flex flex-col bg-surface-900/50 backdrop-blur-sm ${(activeChat || activeGroupChat) ? 'hidden md:flex' : 'flex'}`}>
            {/* Action Buttons */}
            <div className="p-3 border-b border-surface-800 flex gap-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => router.push('/players')}
                className="flex-1 flex items-center justify-center space-x-2 bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 px-3 py-2.5 rounded-lg transition-colors border border-primary-500/30 text-sm"
              >
                <Search className="h-4 w-4" />
                <span>Find Players</span>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowCreateGroupModal(true)}
                className="flex items-center justify-center bg-secondary-500/20 text-secondary-400 hover:bg-secondary-500/30 px-3 py-2.5 rounded-lg transition-colors border border-secondary-500/30"
                title="Create Group"
              >
                <Users className="h-4 w-4" />
                <Plus className="h-3 w-3 -ml-0.5" />
              </motion.button>
            </div>

            {/* Unified Conversation List */}
            <div className="flex-1 overflow-y-auto">
              {unifiedConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-surface-400 p-4">
                  <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
                  <p className="text-center">No conversations yet</p>
                  <p className="text-sm text-center mt-2">Find players or create a group to start chatting!</p>
                </div>
              ) : (
                <AnimatePresence>
                  {unifiedConversations.map((conv, index) => (
                    <motion.button
                      key={`${conv.type}-${conv.id}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.02 }}
                      onClick={() => handleConversationClick(conv)}
                      className={`w-full flex items-center space-x-3 p-4 hover:bg-surface-800/50 transition-colors border-b border-surface-800/50 ${
                        (conv.type === 'direct' && activeChat?.id === conv.id) ||
                        (conv.type === 'group' && activeGroupChat?.id === conv.id)
                          ? 'bg-surface-800/50'
                          : ''
                      }`}
                    >
                      {conv.type === 'direct' ? (
                        <Link
                          href={`/profile/${conv.name}`}
                          onClick={(e) => e.stopPropagation()}
                          className="relative flex-shrink-0 block group"
                        >
                          <AvatarDisplay avatar={conv.avatar} avatarUrl={conv.avatar_url} size="lg" />
                          {!!conv.isOnline && (
                            <span className="absolute bottom-0 right-0 w-3 h-3 bg-success rounded-full border-2 border-surface-900"></span>
                          )}
                        </Link>
                      ) : (
                        <div className="relative flex-shrink-0">
                          <div className="w-12 h-12 rounded-full bg-surface-800 border border-surface-700 flex items-center justify-center text-xl">
                            {conv.avatar || ''}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-surface-700 rounded-full border-2 border-surface-900 flex items-center justify-center">
                            <Users className="h-2.5 w-2.5 text-surface-300" />
                          </span>
                        </div>
                      )}

                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate flex items-center gap-1.5">
                            {conv.name}
                            {conv.type === 'group' && (
                              <span className="text-xs text-surface-500 font-normal">({conv.memberCount})</span>
                            )}
                          </span>
                          {conv.lastMessageTime && (
                            <span className="text-xs text-surface-500">{formatTime(conv.lastMessageTime)}</span>
                          )}
                        </div>
                        <p className="text-sm text-surface-400 truncate">
                          {conv.lastMessageContent ? (
                            <>
                              {conv.type === 'direct' && conv.lastMessageSenderId === user?.id && 'You: '}
                              {conv.type === 'group' && conv.lastMessageSenderUsername && `${conv.lastMessageSenderUsername}: `}
                              {conv.lastMessageContent}
                            </>
                          ) : (
                            <span className="italic text-surface-500">No messages yet</span>
                          )}
                        </p>
                      </div>

                      {conv.unreadCount > 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="flex-shrink-0 w-5 h-5 bg-primary-500 rounded-full text-xs flex items-center justify-center font-medium"
                        >
                          {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                        </motion.span>
                      )}
                    </motion.button>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>

          {/* Chat Window */}
          <div className={`flex-1 flex flex-col ${(!activeChat && !activeGroupChat) ? 'hidden md:flex' : 'flex'}`}>
            {(!activeChat && !activeGroupChat) ? (
              <div className="flex-1 flex items-center justify-center text-surface-400">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center"
                >
                  <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p>Select a conversation or find a player to chat with</p>
                </motion.div>
              </div>
            ) : activeGroupChat ? (
              /* Group Chat View */
              <>
                {/* Group thread bar: always visible. Replaces the old
                    md:hidden mobile-only header so desktop also has a
                    "who you're talking to" strip directly above the
                    message list. */}
                <div className="px-4 py-3 border-b border-surface-800 bg-surface-900/60 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={closeGroupChat}
                      className="text-surface-400 hover:text-white md:hidden"
                      aria-label="Back to conversation list"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-secondary-500 to-accent-600 p-0.5 shrink-0">
                      <div className="w-full h-full rounded-full bg-surface-800 flex items-center justify-center text-lg">
                        {activeGroupChat.avatar || ''}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold leading-tight truncate">{activeGroupChat.name}</h3>
                      <span className="text-xs text-surface-400 leading-tight">
                        {activeGroupChat.members?.length || 1} {activeGroupChat.members?.length === 1 ? 'member' : 'members'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setShowAddMemberModal(true)}
                      className="p-2 text-secondary-400 hover:bg-secondary-500/20 rounded-lg transition-colors"
                      title="Add member"
                      aria-label="Add member"
                    >
                      <UserPlus className="h-5 w-5" />
                    </button>
                    <button
                      onClick={handleLeaveGroup}
                      className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                      title="Leave group"
                      aria-label="Leave group"
                    >
                      <LogOut className="h-5 w-5" />
                    </button>
                    {isGroupCreator && (
                      <button
                        onClick={handleDeleteGroup}
                        className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Delete group"
                        aria-label="Delete group"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Group Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-1">
                  <AnimatePresence>
                    {groupMessages.map((msg, idx) => {
                      const isOwn = msg.sender_id === user?.id;
                      const isEditingThis = editingGroupMessageId === msg.id;
                      const canEdit = isGroupMessageEditable(msg);
                      const showTimestamp = shouldShowTimestamp(groupMessages, idx);
                      const showDateSeparator = shouldShowDateSeparator(groupMessages, idx);
                      // First message of a burst gets the avatar + sender name
                      // header. Continuation bubbles from the same sender (within
                      // TIMESTAMP_BURST_GAP_MS) tighten up: no avatar, no name.
                      const firstOfBurst = isFirstOfBurst(groupMessages, idx);
                      return (
                        <React.Fragment key={msg.id || idx}>
                          {showDateSeparator && <DateSeparator dateString={msg.created_at} />}
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                          className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group ${showTimestamp ? 'pb-2' : ''} ${firstOfBurst && !showDateSeparator ? 'pt-2' : ''}`}
                        >
                          {/* Hover actions (edit/delete) for own messages */}
                          {isOwn && !isEditingThis && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center mr-2 flex items-center gap-1">
                              {canEdit && (
                                <button
                                  onClick={() => handleStartGroupEdit(msg)}
                                  className="p-1 hover:bg-surface-700 rounded"
                                  title="Edit message"
                                >
                                  <Pencil className="h-3.5 w-3.5 text-surface-400" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteGroupMessage(msg.id)}
                                className="p-1 hover:bg-surface-700 rounded"
                                title="Delete message"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-surface-400 hover:text-error" />
                              </button>
                            </div>
                          )}
                          <div className={`max-w-[70%] ${isOwn ? '' : 'flex gap-2'}`}>
                            {!isOwn && (
                              firstOfBurst ? (
                                <AvatarDisplay avatar={msg.sender_avatar} avatarUrl={msg.sender_avatar_url} size="sm" />
                              ) : (
                                // Empty spacer matching avatar size so continuation
                                // bubbles indent under the avatar column.
                                <div className="w-8 shrink-0" aria-hidden="true" />
                              )
                            )}
                            <div className="flex flex-col min-w-0 flex-1">
                            {firstOfBurst && !isOwn && (
                              <div className="flex items-baseline gap-2 px-1 mb-1">
                                <span className="text-xs font-semibold text-primary-300">{msg.sender_username}</span>
                                <span
                                  className="text-[10px] text-surface-400"
                                  title={formatFullTimestamp(msg.created_at)}
                                >
                                  {formatChatTimestamp(msg.created_at)}
                                </span>
                              </div>
                            )}
                            <div
                              onClick={() => !isEditingThis && handleCopyMessage(msg.id, msg.content)}
                              className={`relative rounded-2xl px-4 py-2 cursor-pointer transition-all duration-200 ${
                                isOwn
                                  ? 'bg-primary-500 text-white rounded-br-md'
                                  : 'bg-surface-800 text-white rounded-bl-md'
                              } ${copiedMessageId === msg.id ? 'ring-2 ring-success ring-offset-2 ring-offset-surface-900' : ''}`}
                            >
                              {copiedMessageId === msg.id && (
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-success text-white text-xs px-2 py-1 rounded">
                                  Copied!
                                </div>
                              )}
                              {isEditingThis ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editGroupContent}
                                    onChange={(e) => setEditGroupContent(e.target.value)}
                                    className="w-full min-w-[300px] bg-primary-600 text-white rounded px-3 py-2 text-base resize-y focus:outline-none focus:ring-1 focus:ring-white/30"
                                    rows={4}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleCancelGroupEdit(); }}
                                      className="px-3 py-1.5 hover:bg-primary-600 rounded text-sm"
                                      title="Cancel"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleSaveGroupEdit(msg.id); }}
                                      disabled={editGroupSaving || !editGroupContent.trim()}
                                      className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded disabled:opacity-50 text-sm flex items-center gap-1"
                                      title="Save"
                                    >
                                      {editGroupSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Check className="h-4 w-4" />
                                          Save
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="whitespace-pre-wrap break-words">{linkify(msg.content)}</p>
                              )}
                              {(showTimestamp || msg.edited_at) && (
                                <div className={`text-xs mt-1 flex items-center justify-end gap-1 ${isOwn ? 'text-primary-100' : 'text-surface-400'}`}>
                                  {msg.edited_at && (
                                    <span className="opacity-70 italic">edited</span>
                                  )}
                                  {showTimestamp && (
                                    <span title={formatFullTimestamp(msg.created_at)}>
                                      {formatChatTimestamp(msg.created_at)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            {!isEditingThis && (
                              <MessageReactions
                                reactions={msg.reactions || []}
                                isOwn={isOwn}
                                onToggle={(emoji) => handleToggleGroupMessageReaction(msg.id, emoji)}
                                viewerUsername={user?.username}
                              />
                            )}
                            </div>
                          </div>
                        </motion.div>
                        </React.Fragment>
                      );
                    })}
                  </AnimatePresence>

                  {isGroupTyping && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-start"
                    >
                      <div className="bg-surface-800 rounded-2xl rounded-bl-md px-4 py-2">
                        <div className="flex space-x-1">
                          <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce"></span>
                          <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                          <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Group Input */}
                <div className="relative p-4 border-t border-surface-800 bg-surface-900/50 backdrop-blur-sm">
                  <div className="flex space-x-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={messageInput}
                      onChange={handleGroupInputChange}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendGroupMessage();
                        }
                      }}
                      placeholder="Type a message..."
                      className="flex-1 px-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                      disabled={!connected}
                    />
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleSendGroupMessage}
                      disabled={!messageInput.trim() || sending || !connected}
                      className="px-4 py-3 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                      aria-label="Send message"
                    >
                      {sending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </motion.button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* DM thread bar: always visible on every viewport. Carries
                    the recipient's avatar + name + presence, the Challenge
                    button, and the more-options menu (Report / Block).
                    Replaces the prior md:hidden mobile-only header plus the
                    recipient block that used to live in the page-level
                    app bar (design option B). */}
                <div className="px-4 py-3 border-b border-surface-800 bg-surface-900/60 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={closeChat}
                      className="text-surface-400 hover:text-white md:hidden"
                      aria-label="Back to conversation list"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <Link
                      href={`/profile/${activeChat?.username}`}
                      className="flex items-center gap-3 min-w-0 hover:opacity-90 transition-opacity"
                    >
                      <div className="relative shrink-0">
                        <AvatarDisplay avatar={activeChat?.avatar} avatarUrl={activeChat?.avatar_url} size="md" />
                        {activeChat?.is_online && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-success rounded-full border-2 border-surface-900"></span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight truncate">{activeChat?.username}</h3>
                        {formatActiveStatus(activeChat?.is_online, activeChat?.last_seen) && (
                          <span className={`text-xs leading-tight ${activeChat?.is_online ? 'text-success' : 'text-surface-400'}`}>
                            {formatActiveStatus(activeChat?.is_online, activeChat?.last_seen)}
                          </span>
                        )}
                      </div>
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant={challengeSent ? 'secondary' : 'primary'}
                      size="sm"
                      icon={challengeSent ? Check : Code2}
                      disabled={challengeLoading || challengeSent}
                      onClick={async () => {
                        if (challengeLoading || challengeSent) return;
                        setChallengeLoading(true);
                        try {
                          await sendChallenge(activeChat.id);
                          setChallengeSent(true);
                          setTimeout(() => setChallengeSent(false), 3000);
                        } finally {
                          setChallengeLoading(false);
                        }
                      }}
                    >
                      {challengeLoading ? 'Sending...' : challengeSent ? 'Sent!' : 'Challenge'}
                    </Button>
                    <div className="relative" ref={moreMenuRef}>
                      <button
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
                        aria-label="More options"
                        aria-haspopup="menu"
                        aria-expanded={showMoreMenu}
                      >
                        <MoreVertical className="h-5 w-5 text-surface-400" />
                      </button>
                      <AnimatePresence>
                        {showMoreMenu && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            className="absolute right-0 top-full mt-1 w-48 max-w-[calc(100vw-1rem)] bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-50 overflow-hidden"
                            role="menu"
                          >
                            <button
                              onClick={() => {
                                setShowMoreMenu(false);
                                setShowReportModal(true);
                              }}
                              className="w-full px-4 py-3 text-left text-sm hover:bg-surface-700 transition-colors flex items-center gap-2 text-surface-300"
                              role="menuitem"
                            >
                              <Flag className="h-4 w-4" />
                              Report User
                            </button>
                            <button
                              onClick={() => {
                                setShowMoreMenu(false);
                                setShowBlockModal(true);
                              }}
                              className="w-full px-4 py-3 text-left text-sm hover:bg-surface-700 transition-colors flex items-center gap-2 text-red-400"
                              role="menuitem"
                            >
                              <Ban className="h-4 w-4" />
                              Block User
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-1">
                  <AnimatePresence>
                    {messages.map((msg, idx) => {
                      const isOwn = msg.sender_id === user?.id;
                      const isEditing = editingMessageId === msg.id;
                      const canEdit = isMessageEditable(msg);
                      const showTimestamp = shouldShowTimestamp(messages, idx);
                      const showDateSeparator = shouldShowDateSeparator(messages, idx);
                      return (
                        <React.Fragment key={msg.id || idx}>
                          {showDateSeparator && <DateSeparator dateString={msg.created_at} />}
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                          className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group ${showTimestamp ? 'pb-2' : ''}`}
                        >
                          {/* Hover actions (edit/delete) for own messages */}
                          {isOwn && !isEditing && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center mr-2 flex items-center gap-1">
                              {canEdit && (
                                <button
                                  onClick={() => handleStartEdit(msg)}
                                  className="p-1 hover:bg-surface-700 rounded"
                                  title="Edit message"
                                >
                                  <Pencil className="h-3.5 w-3.5 text-surface-400" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteMessage(msg.id)}
                                className="p-1 hover:bg-surface-700 rounded"
                                title="Delete message"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-surface-400 hover:text-error" />
                              </button>
                            </div>
                          )}
                          <div className={`max-w-[70%] ${isOwn ? '' : 'flex gap-2'}`}>
                            {!isOwn && (
                              <AvatarDisplay avatar={activeChat?.avatar} avatarUrl={activeChat?.avatar_url} size="sm" />
                            )}
                          <div className="flex flex-col min-w-0 flex-1">
                          <div
                            onClick={() => !isEditing && handleCopyMessage(msg.id, msg.content)}
                            className={`relative rounded-2xl px-4 py-2 cursor-pointer transition-all duration-200 ${
                              isOwn
                                ? 'bg-primary-500 text-white rounded-br-md'
                                : 'bg-surface-800 text-white rounded-bl-md'
                            } ${copiedMessageId === msg.id ? 'ring-2 ring-success ring-offset-2 ring-offset-surface-900' : ''}`}
                          >
                            {copiedMessageId === msg.id && (
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-success text-white text-xs px-2 py-1 rounded">
                                Copied!
                              </div>
                            )}
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  className="w-full min-w-[300px] bg-primary-600 text-white rounded px-3 py-2 text-base resize-y focus:outline-none focus:ring-1 focus:ring-white/30"
                                  rows={4}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                                    className="px-3 py-1.5 hover:bg-primary-600 rounded text-sm"
                                    title="Cancel"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleSaveEdit(msg.id); }}
                                    disabled={editSaving || !editContent.trim()}
                                    className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded disabled:opacity-50 text-sm flex items-center gap-1"
                                    title="Save"
                                  >
                                    {editSaving ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <>
                                        <Check className="h-4 w-4" />
                                        Save
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">{linkify(msg.content)}</p>
                            )}
                            {(showTimestamp || msg.edited_at || isOwn) && (
                              <div className={`text-xs mt-1 flex items-center justify-end gap-1 ${isOwn ? 'text-primary-100' : 'text-surface-400'}`}>
                                {msg.edited_at && (
                                  <span className="opacity-70 italic">edited</span>
                                )}
                                {showTimestamp && (
                                  <span title={formatFullTimestamp(msg.created_at)}>
                                    {formatChatTimestamp(msg.created_at)}
                                  </span>
                                )}
                                {isOwn && (
                                  <span className={msg.read_at ? 'text-blue-300' : 'text-primary-200/60'} title={msg.read_at ? 'Read' : 'Sent'}>
                                    {msg.read_at ? '✓✓' : '✓'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {!isEditing && (
                            <MessageReactions
                              reactions={msg.reactions || []}
                              isOwn={isOwn}
                              onToggle={(emoji) => handleToggleMessageReaction(msg.id, emoji)}
                              viewerUsername={user?.username}
                            />
                          )}
                          </div>
                          </div>
                        </motion.div>
                        </React.Fragment>
                      );
                    })}
                  </AnimatePresence>

                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-start"
                    >
                      <div className="bg-surface-800 rounded-2xl rounded-bl-md px-4 py-2">
                        <div className="flex space-x-1">
                          <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce"></span>
                          <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                          <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="relative p-4 border-t border-surface-800 bg-surface-900/50 backdrop-blur-sm">
                  {/* Emoji Picker */}
                  <AnimatePresence>
                    {showEmojiPicker && (
                      <motion.div
                        ref={emojiPickerRef}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-20 right-0 z-50 max-w-[calc(100vw-1rem)]"
                      >
                        <EmojiPicker
                          onEmojiClick={handleEmojiClick}
                          theme="dark"
                          width={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 16 : 320)}
                          height={Math.min(400, typeof window !== 'undefined' ? window.innerHeight - 200 : 400)}
                          searchPlaceholder="Search emoji..."
                          previewConfig={{ showPreview: false }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex space-x-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={messageInput}
                      onChange={handleInputChange}
                      onKeyPress={handleKeyPress}
                      placeholder="Type a message..."
                      className="flex-1 px-4 py-3 bg-surface-800/50 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all"
                      disabled={!connected}
                    />
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className="px-3 py-3 bg-surface-800/50 hover:bg-surface-700/50 border border-surface-700 rounded-xl transition-colors"
                      aria-label="Add emoji"
                    >
                      <Smile className="h-5 w-5 text-surface-400 hover:text-yellow-400" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleSend}
                      disabled={!messageInput.trim() || sending || !connected}
                      className="px-4 py-3 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                      aria-label="Send message"
                    >
                      {sending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </motion.button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Report and Block Modals */}
      {activeChat && (
        <>
          <ReportUserModal
            isOpen={showReportModal}
            onClose={() => setShowReportModal(false)}
            userId={activeChat.id}
            username={activeChat.username}
          />
          <BlockUserModal
            isOpen={showBlockModal}
            onClose={() => setShowBlockModal(false)}
            userId={activeChat.id}
            username={activeChat.username}
            onBlocked={handleBlocked}
          />
        </>
      )}

      {/* Create Group Modal */}
      <AnimatePresence>
        {showCreateGroupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeCreateGroupModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-900 border border-surface-700 rounded-2xl p-6 w-full max-w-md"
            >
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Users className="h-5 w-5 text-secondary-400" />
                Create Group
              </h2>
              <p className="text-surface-400 text-sm mb-4">
                Create a group chat to coordinate with friends for tournaments or casual games.
              </p>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name..."
                className="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-secondary-500 focus:ring-1 focus:ring-secondary-500/50 transition-all mb-4"
                maxLength={50}
                autoFocus
              />
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-surface-500">Invite friends</p>
                  <p className="text-xs text-surface-500">{selectedGroupMemberIds.length}/9 selected</p>
                </div>
                {friends.length === 0 ? (
                  <div className="border border-surface-700 bg-surface-800/50 rounded-lg p-3 text-sm text-surface-400">
                    Add friends first to start a group with members.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {friends.map(friend => {
                      const isSelected = selectedGroupMemberIds.includes(friend.id);
                      const selectionDisabled = !isSelected && selectedGroupMemberIds.length >= 9;
                      return (
                        <button
                          key={friend.id}
                          type="button"
                          onClick={() => toggleGroupMemberSelection(friend.id)}
                          disabled={selectionDisabled}
                          className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
                            isSelected
                              ? 'bg-secondary-500/15 border-secondary-500/40 text-white'
                              : 'bg-surface-800/50 border-surface-700 hover:bg-surface-800 text-surface-200'
                          } ${selectionDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <AvatarDisplay avatar={friend.avatar} avatarUrl={friend.avatar_url} size="sm" />
                            <span className="truncate text-sm font-medium">{friend.username}</span>
                          </span>
                          <span className={`h-5 w-5 rounded border flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'border-secondary-400 bg-secondary-500 text-white' : 'border-surface-600'
                          }`}>
                            {isSelected && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={closeCreateGroupModal}
                  className="flex-1 px-4 py-3 bg-surface-800 hover:bg-surface-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim() || creatingGroup}
                  className="flex-1 px-4 py-3 bg-secondary-500 hover:bg-secondary-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {creatingGroup ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-5 w-5" />
                      Create
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Member Modal */}
      <AnimatePresence>
        {showAddMemberModal && activeGroupChat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => {
              setShowAddMemberModal(false);
              setMemberSearchQuery('');
              setMemberSearchResults([]);
              if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-900 border border-surface-700 rounded-2xl p-6 w-full max-w-md"
            >
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-secondary-400" />
                Add Member to {activeGroupChat.name}
              </h2>

              {/* Current Members */}
              <div className="mb-4">
                <p className="text-xs text-surface-500 mb-2">Current members ({activeGroupChat.members?.length || 1})</p>
                <div className="flex flex-wrap gap-2">
                  {activeGroupChat.members?.map(member => (
                    <span
                      key={member.user_id}
                      className="px-2 py-1 bg-surface-800 rounded-lg text-sm flex items-center gap-1"
                    >
                      <AvatarDisplay avatar={member.avatar} avatarUrl={member.avatar_url} size="xs" />
                      <span>{member.username}</span>
                      {member.role === 'admin' && <span className="text-xs text-secondary-400">(admin)</span>}
                    </span>
                  ))}
                </div>
              </div>

              {/* Search Input */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
                <input
                  type="text"
                  value={memberSearchQuery}
                  onChange={(e) => handleMemberSearch(e.target.value)}
                  placeholder="Search friends to add..."
                  className="w-full pl-10 pr-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:border-secondary-500 focus:ring-1 focus:ring-secondary-500/50 transition-all"
                  autoFocus
                />
                {searchingMembers && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500 animate-spin" />
                )}
              </div>

              {/* Search Results or Suggestions */}
              <div className="max-h-48 overflow-y-auto mb-4">
                {memberSearchResults.length > 0 ? (
                  <div className="space-y-2">
                    {memberSearchResults.map(user => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-3 bg-surface-800/50 rounded-xl hover:bg-surface-800 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <AvatarDisplay user={user} size="md" />
                          <div>
                            <p className="font-medium">{user.username}</p>
                            {user.rating && <p className="text-xs text-surface-400">{user.rating} rating</p>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddMember(user.id)}
                          disabled={addingMember}
                          className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-400 disabled:opacity-50 rounded-lg text-sm flex items-center gap-1 transition-colors"
                        >
                          {addingMember ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                              Add
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : memberSearchQuery && !searchingMembers ? (
                  <p className="text-center text-surface-400 py-4">No users found</p>
                ) : conversations.length > 0 ? (
                  /* Show existing contacts as suggestions */
                  <div className="space-y-2">
                    <p className="text-xs text-surface-500 mb-2">Your contacts</p>
                    {conversations
                      .filter(c => !activeGroupChat?.members?.some(m => m.user_id === c.other_user_id))
                      .slice(0, 5)
                      .map(conv => (
                        <div
                          key={conv.other_user_id}
                          className="flex items-center justify-between p-3 bg-surface-800/50 rounded-xl hover:bg-surface-800 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <AvatarDisplay avatar={conv.other_avatar} avatarUrl={conv.other_avatar_url} size="md" />
                            <p className="font-medium">{conv.other_username}</p>
                          </div>
                          <button
                            onClick={() => handleAddMember(conv.other_user_id)}
                            disabled={addingMember}
                            className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-400 disabled:opacity-50 rounded-lg text-sm flex items-center gap-1 transition-colors"
                          >
                            {addingMember ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Plus className="h-4 w-4" />
                                Add
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                    {conversations.filter(c => !activeGroupChat?.members?.some(m => m.user_id === c.other_user_id)).length === 0 && (
                      <p className="text-center text-surface-500 py-2 text-sm">All contacts already in group</p>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-surface-500 py-4 text-sm">
                    Search for friends by username to add them
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  setShowAddMemberModal(false);
                  setMemberSearchQuery('');
                  setMemberSearchResults([]);
                  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                }}
                className="w-full px-4 py-3 bg-surface-800 hover:bg-surface-700 rounded-xl transition-colors"
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default withAuth(MessagesPage);
