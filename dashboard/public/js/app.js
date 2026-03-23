// dashboard/public/js/app.js
// Frontend logic for the LCS Post Approval Dashboard

(() => {
  'use strict';

  // ── State ──

  let posts = [];
  let currentFilter = 'all';
  let currentPost = null;
  let currentSlideIndex = 0;
  let config = { templates: [], topics: [], platforms: [], slideCount: 6 };

  // ── DOM refs ──

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const postGrid = $('#post-grid');
  const emptyState = $('#empty-state');
  const sidebarStats = $('#sidebar-stats');

  // Modals
  const modalOverlay = $('#modal-overlay');
  const generateOverlay = $('#generate-overlay');
  const settingsOverlay = $('#settings-overlay');

  // ── Init ──

  async function init() {
    await loadConfig();
    await loadPosts();
    await loadSettings();
    bindEvents();
  }

  // ── API helpers ──

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  }

  // ── Load data ──

  async function loadConfig() {
    config = await api('/api/config');
    populateTemplateSelect();
  }

  async function loadPosts() {
    const url = currentFilter === 'all' ? '/api/posts' : `/api/posts?status=${currentFilter}`;
    posts = await api(url);
    renderGrid();
    renderStats();
  }

  async function loadSettings() {
    const settings = await api('/api/settings');
    // Populate settings modal
    const days = Array.isArray(settings.recurring_days) ? settings.recurring_days : [];
    $$('#day-toggles input').forEach((cb) => {
      cb.checked = days.includes(cb.value);
    });
    if (settings.recurring_time) {
      $('#settings-time').value = settings.recurring_time;
    }
    if (settings.batch_size) {
      $('#settings-batch-size').value = settings.batch_size;
      $('#generate-count').value = settings.batch_size;
    }
  }

  function populateTemplateSelect() {
    const sel = $('#edit-template');
    sel.innerHTML = '';
    config.templates.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ');
      sel.appendChild(opt);
    });
  }

  // ── Render grid ──

  function renderGrid() {
    // Remove old cards (keep empty state)
    postGrid.querySelectorAll('.post-card').forEach((c) => c.remove());

    if (posts.length === 0) {
      emptyState.style.display = '';
      return;
    }

    emptyState.style.display = 'none';

    posts.forEach((post) => {
      const card = document.createElement('div');
      card.className = 'post-card';
      card.dataset.id = post.id;

      const thumbSrc = post.rendered
        ? `/slides/${post.id}/slide-01.png?t=${Date.now()}`
        : '';

      card.innerHTML = `
        <div class="post-card-thumbnail">
          ${thumbSrc
            ? `<img src="${thumbSrc}" alt="Slide 1" loading="lazy">`
            : `<span class="no-preview">Rendering...</span>`
          }
        </div>
        <div class="post-card-body">
          <div class="post-card-topic">${escapeHtml(post.topic)}</div>
          <div class="post-card-meta">
            <span class="post-card-template">${escapeHtml(post.template)}</span>
            <span class="status-badge status-${post.status}">${post.status}</span>
          </div>
          ${post.scheduled_at ? `<div class="post-card-meta" style="margin-top:4px;"><span>Scheduled: ${formatDate(post.scheduled_at)}</span></div>` : ''}
        </div>
      `;

      card.addEventListener('click', () => openPost(post.id));
      postGrid.appendChild(card);
    });
  }

  function renderStats() {
    const counts = { draft: 0, approved: 0, scheduled: 0, published: 0, rejected: 0 };
    // Count from all posts (not just filtered)
    posts.forEach((p) => {
      if (counts[p.status] !== undefined) counts[p.status]++;
    });

    sidebarStats.innerHTML = Object.entries(counts)
      .map(([status, count]) => `
        <div class="stat-row">
          <span>${status.charAt(0).toUpperCase() + status.slice(1)}</span>
          <span class="stat-count">${count}</span>
        </div>
      `).join('');
  }

  // ── Open post detail ──

  async function openPost(id) {
    try {
      currentPost = await api(`/api/posts/${id}`);
      currentSlideIndex = 0;
      renderModal();
      modalOverlay.classList.add('visible');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderModal() {
    if (!currentPost) return;

    $('#modal-title').textContent = currentPost.topic;
    $('#edit-topic').value = currentPost.topic;
    $('#edit-template').value = currentPost.template;

    const badge = $('#edit-status-badge');
    badge.textContent = currentPost.status;
    badge.className = `status-badge status-${currentPost.status}`;

    $('#edit-caption').value = currentPost.caption || '';
    $('#edit-caption-linkedin').value = currentPost.caption_linkedin || '';
    $('#edit-caption-instagram').value = currentPost.caption_instagram || '';
    $('#edit-caption-facebook').value = currentPost.caption_facebook || '';

    // Platforms
    $$('#platform-toggles input').forEach((cb) => {
      cb.checked = currentPost.platforms.includes(cb.value);
    });

    // Schedule
    if (currentPost.scheduled_at) {
      // Convert to local datetime-local format
      const dt = new Date(currentPost.scheduled_at + 'Z');
      const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
      $('#edit-schedule').value = local.toISOString().slice(0, 16);
    } else {
      $('#edit-schedule').value = '';
    }

    // Render slide viewer
    renderSlideViewer();
    loadSlideEditor();
  }

  function renderSlideViewer() {
    if (!currentPost || !currentPost.rendered) return;

    const img = $('#slide-image');
    img.src = `/slides/${currentPost.id}/slide-${String(currentSlideIndex + 1).padStart(2, '0')}.png?t=${Date.now()}`;

    $('#slide-counter').textContent = `${currentSlideIndex + 1} / ${currentPost.slides.length}`;

    // Thumbnails
    const thumbs = $('#slide-thumbnails');
    thumbs.innerHTML = '';
    currentPost.slides.forEach((_, i) => {
      const thumb = document.createElement('div');
      thumb.className = `slide-thumb ${i === currentSlideIndex ? 'active' : ''}`;
      thumb.innerHTML = `<img src="/slides/${currentPost.id}/slide-${String(i + 1).padStart(2, '0')}.png?t=${Date.now()}" alt="Slide ${i + 1}">`;
      thumb.addEventListener('click', () => {
        currentSlideIndex = i;
        renderSlideViewer();
        loadSlideEditor();
      });
      thumbs.appendChild(thumb);
    });
  }

  function loadSlideEditor() {
    if (!currentPost) return;
    const slide = currentPost.slides[currentSlideIndex];
    if (!slide) return;

    $('#edit-slide-type').value = slide.type || 'content';
    $('#edit-slide-icon').value = slide.icon || '';
    $('#edit-slide-headline').value = slide.headline || '';
    $('#edit-slide-body').value = slide.body || '';
    $('#edit-slide-footnote').value = slide.footnote || '';
  }

  // ── Event binding ──

  function bindEvents() {
    // Filter buttons
    $$('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.status;
        loadPosts();
      });
    });

    // Generate modal
    $('#btn-generate').addEventListener('click', () => {
      generateOverlay.classList.add('visible');
    });
    $('#generate-close').addEventListener('click', () => {
      generateOverlay.classList.remove('visible');
    });
    $('#btn-generate-go').addEventListener('click', generateBatch);

    // Settings modal
    $('#btn-settings').addEventListener('click', () => {
      settingsOverlay.classList.add('visible');
    });
    $('#settings-close').addEventListener('click', () => {
      settingsOverlay.classList.remove('visible');
    });
    $('#btn-save-settings').addEventListener('click', saveSettings);

    // Post modal
    $('#modal-close').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    // Slide navigation
    $('#slide-prev').addEventListener('click', () => {
      if (currentPost && currentSlideIndex > 0) {
        currentSlideIndex--;
        renderSlideViewer();
        loadSlideEditor();
      }
    });
    $('#slide-next').addEventListener('click', () => {
      if (currentPost && currentSlideIndex < currentPost.slides.length - 1) {
        currentSlideIndex++;
        renderSlideViewer();
        loadSlideEditor();
      }
    });

    // Slide editing
    $('#btn-save-slide').addEventListener('click', saveSlide);
    $('#btn-regenerate-slide').addEventListener('click', regenerateSlide);

    // Template change
    $('#edit-template').addEventListener('change', async () => {
      if (!currentPost) return;
      const newTemplate = $('#edit-template').value;
      if (newTemplate === currentPost.template) return;

      showLoading();
      try {
        currentPost = await api(`/api/posts/${currentPost.id}`, {
          method: 'PUT',
          body: { template: newTemplate },
        });
        renderModal();
        toast('Template changed and slides re-rendered');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        hideLoading();
      }
    });

    // Post actions
    $('#btn-approve').addEventListener('click', () => postAction('approve'));
    $('#btn-reject').addEventListener('click', () => postAction('reject'));
    $('#btn-save-post').addEventListener('click', savePost);
    $('#btn-publish').addEventListener('click', publishPost);
    $('#btn-delete').addEventListener('click', deletePost);
    $('#btn-schedule').addEventListener('click', schedulePost);

    // Keyboard nav
    document.addEventListener('keydown', (e) => {
      if (!modalOverlay.classList.contains('visible')) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (e.key === 'ArrowLeft') {
        $('#slide-prev').click();
      } else if (e.key === 'ArrowRight') {
        $('#slide-next').click();
      } else if (e.key === 'Escape') {
        closeModal();
      }
    });
  }

  function closeModal() {
    modalOverlay.classList.remove('visible');
    currentPost = null;
    loadPosts();
  }

  // ── Actions ──

  async function generateBatch() {
    const count = parseInt($('#generate-count').value) || 5;
    const progress = $('#generate-progress');
    const status = $('#generate-status');

    progress.style.display = '';
    $('#btn-generate-go').disabled = true;
    status.textContent = `Generating ${count} posts... This may take a minute.`;

    try {
      const result = await api('/api/generate', {
        method: 'POST',
        body: { count },
      });

      const successes = result.generated.filter((r) => !r.error).length;
      const failures = result.generated.filter((r) => r.error).length;

      let msg = `Generated ${successes} posts.`;
      if (failures > 0) msg += ` ${failures} failed.`;

      toast(msg, failures > 0 ? 'error' : 'success');
      generateOverlay.classList.remove('visible');
      await loadPosts();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      progress.style.display = 'none';
      $('#btn-generate-go').disabled = false;
    }
  }

  async function saveSlide() {
    if (!currentPost) return;

    const slideData = {
      type: $('#edit-slide-type').value,
      icon: $('#edit-slide-icon').value,
      headline: $('#edit-slide-headline').value,
      body: $('#edit-slide-body').value,
      footnote: $('#edit-slide-footnote').value,
    };

    showLoading();
    try {
      currentPost = await api(`/api/posts/${currentPost.id}/slides/${currentSlideIndex}`, {
        method: 'PUT',
        body: slideData,
      });
      renderSlideViewer();
      toast('Slide saved and re-rendered');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function regenerateSlide() {
    if (!currentPost) return;

    showLoading();
    try {
      currentPost = await api(`/api/posts/${currentPost.id}/regenerate-slide/${currentSlideIndex}`, {
        method: 'POST',
      });
      renderSlideViewer();
      loadSlideEditor();
      toast('Slide regenerated with AI');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function postAction(action) {
    if (!currentPost) return;
    try {
      currentPost = await api(`/api/posts/${currentPost.id}/${action}`, { method: 'POST' });
      renderModal();
      toast(`Post ${action === 'approve' ? 'approved' : 'rejected'}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function savePost() {
    if (!currentPost) return;

    const platforms = [];
    $$('#platform-toggles input:checked').forEach((cb) => platforms.push(cb.value));

    showLoading();
    try {
      currentPost = await api(`/api/posts/${currentPost.id}`, {
        method: 'PUT',
        body: {
          caption: $('#edit-caption').value,
          caption_linkedin: $('#edit-caption-linkedin').value || null,
          caption_instagram: $('#edit-caption-instagram').value || null,
          caption_facebook: $('#edit-caption-facebook').value || null,
          platforms,
        },
      });
      renderModal();
      toast('Post saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function schedulePost() {
    if (!currentPost) return;

    const dtLocal = $('#edit-schedule').value;
    if (!dtLocal) return toast('Pick a date and time first', 'error');

    // Convert local datetime to UTC ISO string
    const dt = new Date(dtLocal);
    const utcStr = dt.toISOString().replace('T', ' ').slice(0, 19);

    try {
      currentPost = await api(`/api/posts/${currentPost.id}/schedule`, {
        method: 'POST',
        body: { scheduled_at: utcStr },
      });
      renderModal();
      toast(`Scheduled for ${formatDate(utcStr)}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function publishPost() {
    if (!currentPost) return;
    if (!confirm('Publish this post to all selected platforms now?')) return;

    showLoading();
    try {
      const result = await api(`/api/posts/${currentPost.id}/publish`, { method: 'POST' });
      currentPost = await api(`/api/posts/${currentPost.id}`);
      renderModal();

      const platformResults = Object.entries(result.results || {})
        .map(([p, r]) => `${p}: ${r}`)
        .join(', ');
      toast(`Published! ${platformResults}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function deletePost() {
    if (!currentPost) return;
    if (!confirm('Delete this post permanently?')) return;

    try {
      await api(`/api/posts/${currentPost.id}`, { method: 'DELETE' });
      toast('Post deleted');
      closeModal();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function saveSettings() {
    const days = [];
    $$('#day-toggles input:checked').forEach((cb) => days.push(cb.value));
    const time = $('#settings-time').value;
    const batchSize = parseInt($('#settings-batch-size').value) || 5;

    try {
      await api('/api/settings', {
        method: 'PUT',
        body: {
          recurring_days: days,
          recurring_time: time,
          batch_size: String(batchSize),
        },
      });
      toast('Settings saved');
      settingsOverlay.classList.remove('visible');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ── Utilities ──

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr.includes('T') ? isoStr : isoStr + 'Z');
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function showLoading() {
    $('#loading-overlay').style.display = '';
  }

  function hideLoading() {
    $('#loading-overlay').style.display = 'none';
  }

  // Toast container
  let toastContainer = document.querySelector('.toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      el.style.transition = 'all 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  // ── Start ──

  init().catch((err) => {
    console.error('Dashboard init failed:', err);
    toast('Failed to initialize dashboard: ' + err.message, 'error');
  });
})();
