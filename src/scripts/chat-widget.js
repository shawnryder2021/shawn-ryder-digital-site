// Floating chat widget for visitor engagement
// Stores conversation history in localStorage, saves to Supabase on visitor email capture

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export function initChatWidget() {
  const container = document.body;
  if (!container) return;

  // Generate visitor ID (based on session)
  const getVisitorId = () => {
    let id = sessionStorage.getItem('visitor_id');
    if (!id) {
      id = `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('visitor_id', id);
    }
    return id;
  };

  const visitorId = getVisitorId();
  let conversationId = sessionStorage.getItem('conversation_id');

  // State
  let isOpen = false;
  let messages = [];
  let isStreaming = false;

  // Load conversation history
  const loadHistory = () => {
    const stored = sessionStorage.getItem(`chat_history_${visitorId}`);
    messages = stored ? JSON.parse(stored) : [];
  };

  const saveHistory = () => {
    sessionStorage.setItem(`chat_history_${visitorId}`, JSON.stringify(messages));
  };

  const saveToDb = async (email) => {
    if (!conversationId) {
      conversationId = `${visitorId}_${Date.now()}`;
      sessionStorage.setItem('conversation_id', conversationId);
    }

    try {
      const { error } = await supabase.from('conversations').upsert(
        {
          id: conversationId,
          visitor_id: visitorId,
          visitor_email: email,
          messages,
        },
        { onConflict: 'id' }
      );
      if (error) console.error('Failed to save conversation:', error);
    } catch (err) {
      console.error('Error saving conversation:', err);
    }
  };

  // Create DOM
  const widget = document.createElement('div');
  widget.className = 'chat-widget';
  widget.innerHTML = `
    <div class="chat-bubble">
      <button class="chat-toggle" aria-label="Toggle chat">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
      </button>
    </div>
    <div class="chat-panel" hidden>
      <div class="chat-header">
        <h3>Need help?</h3>
        <button class="chat-close" aria-label="Close chat">×</button>
      </div>
      <div class="chat-messages"></div>
      <div class="chat-footer">
        <textarea class="chat-input" placeholder="Ask anything..." rows="2"></textarea>
        <button class="chat-send">Send</button>
      </div>
    </div>
  `;

  container.appendChild(widget);

  // Elements
  const toggle = widget.querySelector('.chat-toggle');
  const closeBtn = widget.querySelector('.chat-close');
  const panel = widget.querySelector('.chat-panel');
  const messagesDiv = widget.querySelector('.chat-messages');
  const input = widget.querySelector('.chat-input');
  const sendBtn = widget.querySelector('.chat-send');

  // Render messages
  const renderMessages = () => {
    messagesDiv.innerHTML = '';
    messages.forEach((msg) => {
      const el = document.createElement('div');
      el.className = `chat-message chat-message-${msg.role}`;
      el.textContent = msg.content;
      messagesDiv.appendChild(el);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  };

  // Send message
  const handleSend = async () => {
    const text = input.value.trim();
    if (!text || isStreaming) return;

    // Add user message
    messages.push({ role: 'user', content: text });
    renderMessages();
    input.value = '';
    input.style.height = 'auto';
    isStreaming = true;
    sendBtn.disabled = true;

    // Create placeholder for assistant message
    const assistantMsgEl = document.createElement('div');
    assistantMsgEl.className = 'chat-message chat-message-assistant';
    messagesDiv.appendChild(assistantMsgEl);

    let fullResponse = '';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(0, -1), // Exclude the user message we just added
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              if (json.content) {
                fullResponse += json.content;
                assistantMsgEl.textContent = fullResponse;
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
              }
            } catch {
              // Skip parse errors
            }
          }
        }
      }

      // Save full response to messages
      if (fullResponse) {
        messages[messages.length - 1] = { role: 'assistant', content: fullResponse };
      }
    } catch (error) {
      assistantMsgEl.textContent = "Sorry, I couldn't connect. Please try again.";
      console.error('Chat error:', error);
    } finally {
      saveHistory();
      isStreaming = false;
      sendBtn.disabled = false;
    }
  };

  // Auto-grow textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  // Keyboard shortcuts
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Toggle panel
  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.hidden = !isOpen;
    if (isOpen) {
      renderMessages();
      input.focus();
    }
  });

  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panel.hidden = true;
  });

  sendBtn.addEventListener('click', handleSend);

  // Load history on init
  loadHistory();

  // Expose saveToDb for external use (email capture)
  return { saveToDb, visitorId };
}
