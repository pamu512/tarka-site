/* ============================================================
   TARKA: shared site script
   nav · reveal animations · form validation · lead store · analytics
   ============================================================ */
(function () {
  'use strict';

  var TK = (window.TK = window.TK || {});

  /* ---------- safe localStorage wrapper ---------- */
  var store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) { return false; }
    }
  };
  TK.store = store;

  /* ---------- analytics (self-hosted, no external calls) ---------- */
  var EVENTS_KEY = 'tarka_events';
  TK.track = function (name, props) {
    var evt = {
      event: name,
      path: window.location.pathname,
      title: document.title,
      ref: document.referrer || '(direct)',
      ts: new Date().toISOString()
    };
    if (props) { evt.props = props; }
    var log = store.get(EVENTS_KEY, []);
    log.push(evt);
    if (log.length > 400) { log = log.slice(-400); }
    store.set(EVENTS_KEY, log);
    if (window.console && console.info) { console.info('[tarka-analytics]', evt.event, evt); }
    return evt;
  };

  /* ---------- header nav ---------- */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) { return; }
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) { return; }
    if (!('IntersectionObserver' in window) ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- footer year ---------- */
  function initYear() {
    var el = document.getElementById('year');
    if (el) { el.textContent = String(new Date().getFullYear()); }
  }

  /* ---------- graceful image fallback (never a broken frame) ---------- */
  function initImgFallback() {
    document.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('error', function () {
        if (img.dataset.fallbackDone) { return; }
        img.dataset.fallbackDone = '1';
        var ph = document.createElement('div');
        ph.className = 'ph-img';
        ph.setAttribute('role', 'img');
        ph.setAttribute('aria-label', img.alt || 'Image unavailable');
        ph.textContent = 'Image unavailable';
        if (img.parentNode) { img.parentNode.replaceChild(ph, img); }
      });
    });
  }

  /* ============================================================
     Lead store: persisted contact-form submissions
     ============================================================ */
  var LEADS_KEY = 'tarka_leads_v1';
  var LEAD_TTL_MS = 400 * 24 * 60 * 60 * 1000; // 400 days

  TK.leads = {
    all: function () {
      var now = Date.now();
      var leads = store.get(LEADS_KEY, []).filter(function (l) {
        return now - l._ts < LEAD_TTL_MS;
      });
      return leads;
    },
    count: function () { return TK.leads.all().length; },
    add: function (lead) {
      var entry = Object.assign({}, lead, {
        id: 'T-' + Date.now().toString(36).toUpperCase() + '-' +
            Math.random().toString(36).slice(2, 6).toUpperCase(),
        _ts: Date.now(),
        _storedAt: new Date().toISOString()
      });
      var leads = TK.leads.all();
      leads.push(entry);
      store.set(LEADS_KEY, leads);
      return entry;
    },
    seedDemo: function () {
      if (store.get('tarka_demo_seeded', false)) { return; }
      store.set('tarka_demo_seeded', true);
    },
    clearDemo: function () {
      var kept = TK.leads.all().filter(function (l) { return !l.demo; });
      store.set(LEADS_KEY, kept);
      store.set('tarka_demo_seeded', false);
    }
  };

  /* ============================================================
     Contact form: validation state machine
     errors: on blur after edit; clear on input; summary on submit
     ============================================================ */
  function validatorsFor(field) {
    var v = [];
    if (field.input.name === 'name') {
      v.push(function (val) {
        if (!val.trim()) { return 'Please tell us your name.'; }
        if (val.trim().length < 2) { return 'Your name needs at least 2 characters.'; }
        return '';
      });
    }
    if (field.input.name === 'email') {
      v.push(function (val) {
        if (!val.trim()) { return 'An email address is required so we can reply.'; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim())) {
          return 'That email address looks incomplete: it needs a @ and a domain, e.g. name@example.com.';
        }
        return '';
      });
    }
    if (field.input.name === 'message') {
      v.push(function (val) {
        if (!val.trim()) { return 'Please add a short message so we know how to help.'; }
        if (val.trim().length < 10) { return 'Could you add a little more detail? At least 10 characters, so we can reply properly.'; }
        return '';
      });
    }
    return v;
  }

  function setupForm(form) {
    var fields = [];
    form.querySelectorAll('[data-tarka-field]').forEach(function (input) {
      var wrap = input.closest('.field');
      if (!wrap) { return; }
      fields.push({
        input: input,
        wrap: wrap,
        errorEl: wrap.querySelector('.field-error'),
        validators: validatorsFor({ input: input })
      });
    });

    var summary = form.querySelector('.error-summary');
    var summaryList = summary ? summary.querySelector('ul') : null;
    var submitBtn = form.querySelector('[type="submit"]');

    function runValidators(field) {
      var val = field.input.value;
      var msg = '';
      for (var i = 0; i < field.validators.length; i++) {
        msg = field.validators[i](val);
        if (msg) { break; }
      }
      return msg;
    }

    function showError(field, msg) {
      field.wrap.classList.add('is-invalid');
      field.input.setAttribute('aria-invalid', 'true');
      if (field.errorEl) { field.errorEl.textContent = msg; }
    }

    function clearError(field) {
      field.wrap.classList.remove('is-invalid');
      field.input.removeAttribute('aria-invalid');
      if (field.errorEl) { field.errorEl.textContent = ''; }
    }

    function refreshSummary() {
      if (!summary || !summaryList) { return; }
      var invalid = fields.filter(function (f) { return f.wrap.classList.contains('is-invalid'); });
      var count = invalid.length;
      summary.classList.toggle('is-visible', count > 0);
      summary.querySelector('h2').textContent =
        count === 1 ? '1 problem needs fixing' : count + ' problems need fixing';
      summaryList.innerHTML = '';
      invalid.forEach(function (f) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + f.input.id;
        a.textContent = (f.wrap.querySelector('label') || {}).textContent + ': ' + (f.errorEl ? f.errorEl.textContent : '');
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          f.input.focus();
        });
        li.appendChild(a);
        summaryList.appendChild(li);
      });
    }

    fields.forEach(function (field) {
      field.input.addEventListener('blur', function () {
        if (!field.input.value && !field.input.dataset.touched) { return; }
        field.input.dataset.touched = '1';
        var msg = runValidators(field);
        if (msg) { showError(field, msg); } else { clearError(field); }
        refreshSummary();
      });
      field.input.addEventListener('input', function () {
        if (field.wrap.classList.contains('is-invalid')) {
          var msg = runValidators(field);
          if (msg) { showError(field, msg); } else { clearError(field); refreshSummary(); }
        }
      });
    });

    function setSubmitting(busy) {
      if (!submitBtn) { return; }
      submitBtn.disabled = busy;
      submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
      var status = form.querySelector('.form-status');
      if (status) {
        status.setAttribute('role', 'status');
        status.textContent = busy ? 'Sending your message\u2026' : '';
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      /* honeypot: silently accept bot submissions without storing */
      var hp = form.querySelector('[name="company_website"]');
      if (hp && hp.value) {
        TK.track('lead_bot_blocked');
        form.hidden = true;
        var ok = form.parentElement.querySelector('.form-success');
        if (ok) { ok.hidden = false; }
        return;
      }

      var firstInvalid = null;
      fields.forEach(function (field) {
        var msg = runValidators(field);
        if (msg) {
          showError(field, msg);
          if (!firstInvalid) { firstInvalid = field; }
        } else {
          clearError(field);
        }
      });
      refreshSummary();

      if (firstInvalid) {
        if (summary && summary.classList.contains('is-visible')) {
          summary.focus();
        } else if (firstInvalid) {
          firstInvalid.input.focus();
        }
        TK.track('lead_validation_failed');
        return;
      }

      setSubmitting(true);
      var payload = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        company: form.elements.company ? form.elements.company.value.trim() : '',
        topic: form.elements.topic ? form.elements.topic.value : 'general',
        budget: form.elements.budget ? form.elements.budget.value : '',
        message: form.elements.message.value.trim(),
        source: 'website'
      };

      /* Static GitHub Pages: open a prefilled GitHub issue so maintainers actually get it. */
      var entry;
      try {
        entry = TK.leads.add(payload);
      } catch (err) {
        entry = { id: 'T-LOCAL' };
      }
      var titlePrefix = payload.topic === 'commercial'
        ? '[commercial] pilot scope request'
        : '[site] ' + payload.topic;
      var issueTitle = titlePrefix + ': ' + payload.name;
      var issueBody = [
        '**From:** ' + payload.name + ' <' + payload.email + '>',
        payload.company ? '**Organization:** ' + payload.company : null,
        '**Topic:** ' + payload.topic,
        '',
        payload.message,
        '',
        '_Submitted via tarka-site contact form_'
      ].filter(Boolean).join('\n');
      var issueUrl = 'https://github.com/pamu512/tarka/issues/new?title=' +
        encodeURIComponent(issueTitle) + '&body=' + encodeURIComponent(issueBody);
      try {
        window.open(issueUrl, '_blank', 'noopener');
      } catch (err) { /* noop */ }
      setSubmitting(false);
      TK.track('lead_submitted', { topic: payload.topic, ref: entry.id, via: 'github_issue' });
      var success = form.parentElement ? form.parentElement.querySelector('.form-success') : null;
      if (!success) { return; }
      form.hidden = true;
      var refEl = success.querySelector('.ref');
      if (refEl) { refEl.textContent = 'Reference ' + entry.id + '. File the GitHub issue to send this.'; }
      var h2 = success.querySelector('h2');
      var firstName = payload.name ? payload.name.split(' ')[0] : '';
      if (h2) {
        h2.textContent = firstName
          ? 'Thank you, ' + firstName + '. Finish the GitHub issue to send this.'
          : 'Finish the GitHub issue to send this.';
      }
      var lead = success.querySelector('.lead');
      if (lead) {
        lead.textContent = '';
        lead.appendChild(document.createTextNode('A GitHub issue draft opens in a new tab. If it does not, file it at '));
        var issueLink = document.createElement('a');
        issueLink.className = 'text-link';
        issueLink.href = 'https://github.com/pamu512/tarka/issues/new';
        issueLink.rel = 'noopener';
        issueLink.textContent = 'github.com/pamu512/tarka/issues/new';
        lead.appendChild(issueLink);
        lead.appendChild(document.createTextNode(' with title '));
        var titleCode = document.createElement('code');
        titleCode.className = 'code-inline';
        titleCode.textContent = titlePrefix;
        lead.appendChild(titleCode);
        lead.appendChild(document.createTextNode('.'));
      }
      success.hidden = false;
      success.setAttribute('tabindex', '-1');
      success.focus();
    });
  }

  function initForms() {
    document.querySelectorAll('form[data-tarka-form]').forEach(setupForm);
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initReveal();
    initYear();
    initForms();
    initImgFallback();
    TK.track('page_view');
  });
})();
