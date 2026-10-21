// Workshop settings: choose which slides to show and who is leading the workshop.
//
// Usage (before and after creating WebSlides):
//   WorkshopSettings.apply();          // removes hidden slides, renders the team slide
//   window.ws = new WebSlides();
//   WorkshopSettings.mount();          // adds the settings button / panel (press "S")
//
// Slide markup hooks:
//   <section data-slide-id="x">  stable id for a slide (otherwise derived from its title)
//   <section data-title="...">   label shown in the settings (otherwise its first heading)
//   <section data-chapter>       starts a chapter in the settings list (as do .bg-gradient-v dividers)
//   <div data-team></div>        where the team is rendered
//   <a data-goto="x">            link to the slide with data-slide-id="x"; hidden if that slide is hidden
//   <img data-placeholder="...">  shows a "Bild fehlt" box with this hint until the image file exists
(function () {
    var STORAGE_PREFIX = 'workshop-settings:';
    var TEAM_KEY = STORAGE_PREFIX + 'team';
    var SLIDES_KEY = STORAGE_PREFIX + 'slides:' + (location.pathname.split('/').pop() || 'index');

    var team = window.WORKSHOP_TEAM || [];
    var slides = [];  // {el, id, title, chapter, number} for every slide, hidden or not

    // ---------- storage ----------

    function load(key, fallback) {
        try {
            var value = localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function save(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* storage unavailable: settings last until reload only */ }
    }

    function getLeads() {
        var leads = load(TEAM_KEY, {}).leads;
        // Nobody chosen yet: everyone is featured, like the original team slide.
        return Array.isArray(leads) ? leads : team.map(function (m) { return m.id; });
    }

    function getHidden() {
        var hidden = load(SLIDES_KEY, {}).hidden;
        return Array.isArray(hidden) ? hidden : [];
    }

    // ---------- helpers ----------

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function slugify(text) {
        return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slide';
    }

    function slideTitle(section, number) {
        if (section.dataset.title) return section.dataset.title;
        var heading = section.querySelector('h1, h2, h3, .text-subtitle');
        var text = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
        return text || 'Slide ' + number;
    }

    function collectSlides() {
        var used = {};
        var sections = document.querySelectorAll('#webslides > section');
        return Array.prototype.map.call(sections, function (section, i) {
            var title = slideTitle(section, i + 1);
            var id = section.dataset.slideId || slugify(title);
            if (used[id]) id += '-' + (++used[id]);
            else used[id] = 1;
            return {
                el: section,
                id: id,
                title: title,
                chapter: section.hasAttribute('data-chapter') || section.classList.contains('bg-gradient-v'),
                number: i + 1
            };
        });
    }

    // ---------- team slide ----------

    function renderTeam(container, leadIds) {
        var leads = team.filter(function (m) { return leadIds.indexOf(m.id) !== -1; });
        var others = team.filter(function (m) { return leadIds.indexOf(m.id) === -1; });
        if (!leads.length) {
            leads = team;
            others = [];
        }

        var html = '<ul class="team-leads">' + leads.map(function (m) {
            return '<li class="team-card">' +
                '<img src="' + escapeHtml(m.photo) + '" alt="' + escapeHtml(m.name) + '">' +
                '<h4>' + escapeHtml(m.name) + '</h4>' +
                '<p>' + escapeHtml(m.role) + '</p>' +
                '</li>';
        }).join('') + '</ul>';

        if (others.length) {
            html += '<aside class="team-others">' +
                '<p class="team-others-title">' + escapeHtml(container.dataset.othersTitle || 'Also on the team') + '</p>' +
                '<ul>' + others.map(function (m) {
                    return '<li>' +
                        '<img src="' + escapeHtml(m.photo) + '" alt="">' +
                        '<span><strong>' + escapeHtml(m.name) + '</strong>' + escapeHtml(m.role) + '</span>' +
                        '</li>';
                }).join('') + '</ul></aside>';
        }

        container.className = 'team' + (others.length ? ' has-others' : '');
        container.innerHTML = html;
    }

    // ---------- apply settings to the deck ----------

    function apply() {
        slides = collectSlides();
        var hidden = getHidden();
        var visible = slides.filter(function (s) { return hidden.indexOf(s.id) === -1; });
        if (!visible.length) visible = slides;  // never present an empty deck

        Array.prototype.forEach.call(document.querySelectorAll('[data-team]'), function (el) {
            renderTeam(el, getLeads());
        });

        // Point internal links at the slide's new position, or hide them if it is gone.
        Array.prototype.forEach.call(document.querySelectorAll('a[data-goto]'), function (a) {
            var index = visible.map(function (s) { return s.id; }).indexOf(a.dataset.goto);
            var item = a.closest('li') || a;
            if (index === -1) {
                item.hidden = true;
            } else {
                item.hidden = false;
                a.href = '#slide=' + (index + 1);
            }
        });

        slides.forEach(function (s) {
            if (visible.indexOf(s) === -1) s.el.parentNode.removeChild(s.el);
        });

        Array.prototype.forEach.call(document.querySelectorAll('img[data-placeholder]'), watchPlaceholder);
    }

    // ---------- image placeholders ----------

    // <img src="assets/images/x.jpg" data-placeholder="what to download">: until the file exists,
    // show a box naming the expected file and the suggestion instead of a broken image.
    function watchPlaceholder(img) {
        function replace() {
            var box = document.createElement('div');
            box.className = 'img-placeholder ' + img.className;
            box.innerHTML = '<strong>Bild fehlt</strong>' +
                '<span>' + escapeHtml(img.dataset.placeholder) + '</span>' +
                '<code>' + escapeHtml(img.getAttribute('src')) + '</code>';
            img.parentNode.replaceChild(box, img);
        }
        if (img.complete && img.naturalWidth === 0) replace();
        else img.addEventListener('error', replace);
    }

    // ---------- settings panel ----------

    var GEAR_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

    var panel = null;
    var toggleButton = null;

    function buildPanel() {
        panel = document.createElement('div');
        panel.className = 'ws-settings';
        panel.hidden = true;
        panel.innerHTML =
            '<div class="ws-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ws-settings-title">' +
            '  <div class="ws-settings-header">' +
            '    <h2 id="ws-settings-title">Workshop settings</h2>' +
            '    <button type="button" class="ws-settings-close" data-action="cancel" aria-label="Close">&times;</button>' +
            '  </div>' +
            '  <div class="ws-settings-body">' +
            '    <div class="ws-settings-group">' +
            '      <h3>Leading this workshop</h3>' +
            '      <p class="ws-settings-hint">Leads are featured on the team slide. Everyone else is credited smaller at the side.</p>' +
            '      <ul class="ws-settings-leads"></ul>' +
            '    </div>' +
            '    <div class="ws-settings-group">' +
            '      <div class="ws-settings-row">' +
            '        <h3>Slides</h3>' +
            '        <span class="ws-settings-count"></span>' +
            '        <button type="button" class="ws-btn ws-btn-small" data-action="show-all">Show all</button>' +
            '      </div>' +
            '      <p class="ws-settings-hint">Unchecked slides are left out of the presentation.</p>' +
            '      <ol class="ws-settings-slides"></ol>' +
            '    </div>' +
            '  </div>' +
            '  <div class="ws-settings-footer">' +
            '    <button type="button" class="ws-btn" data-action="reset">Reset to defaults</button>' +
            '    <span class="ws-settings-spacer"></span>' +
            '    <button type="button" class="ws-btn" data-action="cancel">Cancel</button>' +
            '    <button type="button" class="ws-btn ws-btn-primary" data-action="save">Save &amp; apply</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(panel);

        panel.addEventListener('click', function (event) {
            if (event.target === panel) return close();
            var button = event.target.closest('[data-action]');
            if (!button) return;
            var action = button.dataset.action;
            if (action === 'cancel') close();
            if (action === 'save') saveAndReload();
            if (action === 'reset') fill(team.map(function (m) { return m.id; }), []);
            if (action === 'show-all') setChecked(slides, true);
            if (action === 'chapter') toggleChapter(button.dataset.id);
        });
        panel.addEventListener('change', updateCount);

        // Keep the deck from reacting to scrolling/swiping inside the panel.
        ['wheel', 'touchstart', 'touchmove', 'touchend'].forEach(function (type) {
            panel.addEventListener(type, function (event) { event.stopPropagation(); });
        });
    }

    function fill(leadIds, hidden) {
        panel.querySelector('.ws-settings-leads').innerHTML = team.map(function (m) {
            return '<li><label>' +
                '<input type="checkbox" name="lead" value="' + escapeHtml(m.id) + '"' +
                (leadIds.indexOf(m.id) !== -1 ? ' checked' : '') + '>' +
                '<img src="' + escapeHtml(m.photo) + '" alt="">' +
                '<span><strong>' + escapeHtml(m.name) + '</strong>' + escapeHtml(m.role) + '</span>' +
                '</label></li>';
        }).join('');

        panel.querySelector('.ws-settings-slides').innerHTML = slides.map(function (s) {
            return '<li class="' + (s.chapter ? 'is-chapter' : '') + '"><label>' +
                '<input type="checkbox" name="slide" value="' + escapeHtml(s.id) + '"' +
                (hidden.indexOf(s.id) === -1 ? ' checked' : '') + '>' +
                '<span class="ws-slide-number">' + s.number + '</span>' +
                '<span class="ws-slide-title">' + escapeHtml(s.title) + '</span>' +
                '</label>' +
                (s.chapter ? '<button type="button" class="ws-btn ws-btn-small" data-action="chapter" data-id="' +
                    escapeHtml(s.id) + '">Toggle chapter</button>' : '') +
                '</li>';
        }).join('');

        updateCount();
    }

    function slideCheckbox(id) {
        return panel.querySelector('input[name="slide"][value="' + CSS.escape(id) + '"]');
    }

    function setChecked(list, checked) {
        list.forEach(function (s) { slideCheckbox(s.id).checked = checked; });
        updateCount();
    }

    // A chapter is its divider slide plus every slide up to the next divider.
    function toggleChapter(id) {
        var start = slides.map(function (s) { return s.id; }).indexOf(id);
        var chapter = [slides[start]];
        for (var i = start + 1; i < slides.length && !slides[i].chapter; i++) chapter.push(slides[i]);
        var allShown = chapter.every(function (s) { return slideCheckbox(s.id).checked; });
        setChecked(chapter, !allShown);
    }

    function readForm() {
        function values(name, checked) {
            return Array.prototype.filter.call(panel.querySelectorAll('input[name="' + name + '"]'), function (input) {
                return input.checked === checked;
            }).map(function (input) { return input.value; });
        }
        return { leads: values('lead', true), hidden: values('slide', false) };
    }

    function updateCount() {
        var form = readForm();
        var shown = slides.length - form.hidden.length;
        panel.querySelector('.ws-settings-count').textContent = shown + ' of ' + slides.length + ' shown';
        panel.querySelector('[data-action="save"]').disabled = shown === 0;
    }

    function saveAndReload() {
        var form = readForm();
        save(TEAM_KEY, { leads: form.leads });
        save(SLIDES_KEY, { hidden: form.hidden });

        // Stay on the current slide (or the closest earlier one still shown) after reloading.
        var current = document.querySelector('#webslides > section.current');
        var position = slides.map(function (s) { return s.el; }).indexOf(current);
        var visible = slides.filter(function (s) { return form.hidden.indexOf(s.id) === -1; });
        var target = 0;
        visible.forEach(function (s, i) {
            if (slides.indexOf(s) <= position) target = i;
        });
        history.replaceState(null, '', '#slide=' + (target + 1));
        location.reload();
    }

    function open() {
        if (!panel) buildPanel();
        fill(getLeads(), getHidden());
        panel.hidden = false;
        document.documentElement.classList.add('ws-settings-open');
        panel.querySelector('input').focus();
    }

    function close() {
        if (!panel || panel.hidden) return;
        panel.hidden = true;
        document.documentElement.classList.remove('ws-settings-open');
        toggleButton.focus();
    }

    function isOpen() {
        return panel && !panel.hidden;
    }

    function isTyping(target) {
        return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    }

    function mount() {
        toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'ws-settings-toggle';
        toggleButton.title = 'Workshop settings (S)';
        toggleButton.setAttribute('aria-label', 'Workshop settings');
        toggleButton.innerHTML = GEAR_ICON;
        toggleButton.addEventListener('click', open);
        document.body.appendChild(toggleButton);

        // Capture phase so the deck's own key handlers never see keys meant for the panel.
        window.addEventListener('keydown', function (event) {
            if (isOpen()) {
                event.stopPropagation();
                if (event.key === 'Escape') close();
                return;
            }
            if ((event.key === 's' || event.key === 'S') && !event.ctrlKey && !event.metaKey &&
                !event.altKey && !isTyping(event.target)) {
                event.preventDefault();
                open();
            }
        }, true);
    }

    window.WorkshopSettings = { apply: apply, mount: mount, open: open };
})();
