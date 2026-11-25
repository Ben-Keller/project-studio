(() => {
  const dataNode = document.getElementById('portfolioData');
  const portfolioMode = document.getElementById('portfolioMode');
  const studioMode = document.getElementById('studioMode');
  const settingsRoot = document.getElementById('portfolioSettings');
  const previewRoot = document.getElementById('portfolioPreview');
  const templateRail = document.getElementById('portfolioTemplateRail');
  const stageTitle = document.getElementById('portfolioStageTitle');
  const stageMeta = document.getElementById('portfolioStageMeta');
  const resetButton = document.getElementById('portfolioReset');
  if (!dataNode || !portfolioMode || !studioMode || !settingsRoot || !previewRoot || !templateRail) return;

  const payload = JSON.parse(dataNode.textContent || '{}');
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  const defaults = payload.defaults || {};
  const storageKey = 'projectStudioPortfolioSettings';
  const modeStorageKey = 'projectStudioMode';
  let editorSlug = defaults.featuredSlug || projects[0]?.slug || '';

  const paletteMap = {
    'cyan-emerald': ['#9ddcf0', '#72efc5'],
    'saffron-blue': ['#ffd36e', '#78b7ff'],
    'rose-graphite': ['#ff9bb6', '#b8c1d9'],
    'lime-ink': ['#c5ff73', '#78d8ff'],
    'violet-gold': ['#b79cff', '#ffd36e'],
    'mono': ['#f2f2f2', '#9a9a9a'],
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeJsonParse(value, fallback) {
    try {
      const parsed = JSON.parse(value || '');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function loadSettings() {
    const saved = safeJsonParse(localStorage.getItem(storageKey), {});
    return {
      ...clone(defaults),
      ...saved,
      projectTemplates: { ...(defaults.projectTemplates || {}), ...(saved.projectTemplates || {}) },
      projectOverrides: { ...(defaults.projectOverrides || {}), ...(saved.projectOverrides || {}) },
    };
  }

  let settings = loadSettings();

  function saveSettings() {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function slugProject(slug) {
    return projects.find(project => project.slug === slug) || projects[0];
  }

  function parseList(value, fallback = []) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean).length
      ? String(value).split(',').map(item => item.trim()).filter(Boolean)
      : fallback;
  }

  function parseMetrics(value, fallback = []) {
    if (Array.isArray(value)) return value;
    const rows = String(value || '').split('\n').map(row => row.trim()).filter(Boolean).map(row => {
      const parts = row.split('|').map(part => part.trim());
      return { value: parts[0] || '1 surface', label: parts[1] || 'Portfolio metric' };
    });
    return rows.length ? rows : fallback;
  }

  function metricText(project) {
    return (project.impactMetrics || []).map(metric => `${metric.value} | ${metric.label}`).join('\n');
  }

  function mergedProject(project) {
    const override = settings.projectOverrides?.[project.slug] || {};
    const screenshots = { ...(project.screenshots || {}), ...(override.screenshots || {}) };
    return {
      ...project,
      ...override,
      screenshots,
      tags: parseList(override.tags, project.tags || []),
      techStack: parseList(override.techStack, project.techStack || []),
      keyFeatures: parseList(override.keyFeatures, project.keyFeatures || []),
      impactMetrics: parseMetrics(override.impactMetrics, project.impactMetrics || []),
    };
  }

  function visibleProjects() {
    const hidden = new Set(settings.hiddenProjects || []);
    const merged = projects.map(mergedProject).filter(project => !hidden.has(project.slug));
    const sorted = [...merged];
    const order = settings.ordering || 'priority';
    sorted.sort((a, b) => {
      if (order === 'name') return a.name.localeCompare(b.name);
      if (order === 'category') return `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`);
      if (order === 'year') return String(b.year || '').localeCompare(String(a.year || '')) || a.name.localeCompare(b.name);
      if (order === 'featured') {
        const aFeatured = a.slug === settings.featuredSlug ? 0 : 1;
        const bFeatured = b.slug === settings.featuredSlug ? 0 : 1;
        return aFeatured - bFeatured || Number(a.displayPriority || 999) - Number(b.displayPriority || 999);
      }
      return Number(a.displayPriority || 999) - Number(b.displayPriority || 999) || a.name.localeCompare(b.name);
    });
    return sorted;
  }

  function featuredProject(list = visibleProjects()) {
    return list.find(project => project.slug === settings.featuredSlug) || list.find(project => project.featured) || list[0] || mergedProject(projects[0]);
  }

  function optionHtml(items, selected) {
    return items.map(item => `<option value="${escapeAttr(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
  }

  function boolControl(key, label) {
    return `<label class="portfolio-toggle"><span>${escapeHtml(label)}</span><input type="checkbox" data-setting="${escapeAttr(key)}" ${settings[key] ? 'checked' : ''}></label>`;
  }

  function textControl(key, label, multiline = false) {
    const value = settings[key] ?? '';
    return `<div class="portfolio-control"><label for="portfolio-${escapeAttr(key)}">${escapeHtml(label)}</label>${multiline ? `<textarea id="portfolio-${escapeAttr(key)}" data-setting="${escapeAttr(key)}">${escapeHtml(value)}</textarea>` : `<input id="portfolio-${escapeAttr(key)}" type="text" data-setting="${escapeAttr(key)}" value="${escapeAttr(value)}">`}</div>`;
  }

  function choiceButtons(key, choices) {
    return `<div class="portfolio-switch-grid">${choices.map(choice => `<button type="button" class="portfolio-choice ${settings[key] === choice.value ? 'is-selected' : ''}" data-setting-choice="${escapeAttr(key)}" data-value="${escapeAttr(choice.value)}">${escapeHtml(choice.label)}</button>`).join('')}</div>`;
  }

  function selectedEditorProject() {
    return mergedProject(slugProject(editorSlug));
  }

  function renderSettings() {
    if (!projects.length) {
      settingsRoot.innerHTML = "<p>Add a project in Studio to customize its portfolio presentation.</p>";
      return;
    }
    const project = selectedEditorProject();
    const override = settings.projectOverrides?.[project.slug] || {};
    const hidden = new Set(settings.hiddenProjects || []);
    settingsRoot.innerHTML = `
      <fieldset class="portfolio-fieldset">
        <legend>Page</legend>
        ${textControl('title', 'Portfolio title')}
        ${textControl('subtitle', 'Deck line')}
        ${textControl('studioName', 'Studio name')}
        ${textControl('intro', 'Intro paragraph', true)}
        ${textControl('footerText', 'Footer / contact text')}
        <div class="portfolio-control"><label for="portfolio-featuredSlug">Featured project</label><select id="portfolio-featuredSlug" data-setting="featuredSlug">${optionHtml(projects.map(item => ({ value: item.slug, label: item.name })), settings.featuredSlug)}</select></div>
        <div class="portfolio-control"><label for="portfolio-ordering">Project ordering</label><select id="portfolio-ordering" data-setting="ordering">${optionHtml([{value:'priority',label:'Curated priority'},{value:'featured',label:'Featured first'},{value:'name',label:'A to Z'},{value:'category',label:'Category'},{value:'year',label:'Newest year'}], settings.ordering)}</select></div>
        <div class="portfolio-control"><label>Density</label>${choiceButtons('density', [{value:'compact',label:'Compact'},{value:'standard',label:'Standard'},{value:'spacious',label:'Spacious'}])}</div>
      </fieldset>
      <fieldset class="portfolio-fieldset">
        <legend>Visibility</legend>
        ${boolControl('showMetadata', 'Show metadata')}
        ${boolControl('showMetrics', 'Show metrics')}
        ${boolControl('showTechStack', 'Show tech stack')}
        ${boolControl('showDescriptions', 'Show long descriptions')}
        ${boolControl('showTags', 'Show tags')}
      </fieldset>
      <fieldset class="portfolio-fieldset">
        <legend>Visual system</legend>
        <div class="portfolio-control"><label>Theme</label>${choiceButtons('themeMode', [{value:'dark',label:'Dark'},{value:'light',label:'Light'},{value:'system',label:'System'}])}</div>
        <div class="portfolio-control"><label>Accent palette</label>${choiceButtons('accentPalette', [{value:'cyan-emerald',label:'Cyan'},{value:'saffron-blue',label:'Saffron'},{value:'rose-graphite',label:'Rose'},{value:'lime-ink',label:'Lime'},{value:'violet-gold',label:'Violet'},{value:'mono',label:'Mono'}])}</div>
        <div class="portfolio-control"><label for="portfolio-backgroundStyle">Background</label><select id="portfolio-backgroundStyle" data-setting="backgroundStyle">${optionHtml([{value:'cinematic-dark',label:'Cinematic dark'},{value:'gradient',label:'Gradient'},{value:'radial-glow',label:'Radial glow'},{value:'editorial-paper',label:'Editorial paper'},{value:'grid',label:'Grid'},{value:'solid',label:'Solid'}], settings.backgroundStyle)}</select></div>
        <div class="portfolio-control"><label>Typography scale</label>${choiceButtons('typographyScale', [{value:'compact',label:'Small'},{value:'standard',label:'Standard'},{value:'large',label:'Large'}])}</div>
        <div class="portfolio-control"><label>Corner radius</label>${choiceButtons('radiusScale', [{value:'sharp',label:'Sharp'},{value:'soft',label:'Soft'},{value:'round',label:'Round'}])}</div>
        <div class="portfolio-control"><label>Screenshot frame</label>${choiceButtons('screenshotFrameStyle', [{value:'browser',label:'Browser'},{value:'device',label:'Device'},{value:'glass',label:'Glass'},{value:'raw',label:'Raw'},{value:'monitor',label:'Monitor'},{value:'phone',label:'Phone'}])}</div>
        <div class="portfolio-control"><label>Animation</label>${choiceButtons('animationLevel', [{value:'none',label:'None'},{value:'subtle',label:'Subtle'},{value:'cinematic',label:'Cinematic'}])}</div>
        <div class="portfolio-control"><label>Image shadow</label>${choiceButtons('imageShadowIntensity', [{value:'none',label:'None'},{value:'soft',label:'Soft'},{value:'strong',label:'Strong'},{value:'cinematic',label:'Cinematic'}])}</div>
        <div class="portfolio-control"><label>Page width</label>${choiceButtons('pageWidth', [{value:'compact',label:'Compact'},{value:'editorial',label:'Editorial'},{value:'wide',label:'Wide'},{value:'full',label:'Full'}])}</div>
      </fieldset>
      <fieldset class="portfolio-fieldset project-editor">
        <legend>Project editor</legend>
        <div class="portfolio-control"><label for="portfolioProjectSelect">Project</label><select id="portfolioProjectSelect" data-project-select>${optionHtml(projects.map(item => ({ value: item.slug, label: item.name })), project.slug)}</select></div>
        <div class="project-editor__actions">
          <button type="button" data-project-toggle="visible">${hidden.has(project.slug) ? 'Show project' : 'Hide project'}</button>
          <button type="button" data-project-toggle="featured">Make featured</button>
        </div>
        <div class="portfolio-control"><label>Display title</label><input type="text" data-project-field="name" value="${escapeAttr(override.name ?? project.name)}"></div>
        <div class="portfolio-control"><label>Cinematic headline</label><input type="text" data-project-field="headline" value="${escapeAttr(override.headline ?? project.headline)}"></div>
        <div class="portfolio-control"><label>One-sentence summary</label><textarea data-project-field="summary">${escapeHtml(override.summary ?? project.summary)}</textarea></div>
        <div class="portfolio-control"><label>Long description</label><textarea data-project-field="description">${escapeHtml(override.description ?? project.description)}</textarea></div>
        <div class="portfolio-control"><label>Category</label><input type="text" data-project-field="category" value="${escapeAttr(override.category ?? project.category)}"></div>
        <div class="portfolio-control"><label>Status</label><input type="text" data-project-field="status" value="${escapeAttr(override.status ?? project.status)}"></div>
        <div class="portfolio-control"><label>Tags (comma-separated)</label><input type="text" data-project-field="tags" value="${escapeAttr((override.tags || project.tags || []).join(', '))}"></div>
        <div class="portfolio-control"><label>Tech stack (comma-separated)</label><input type="text" data-project-field="techStack" value="${escapeAttr((override.techStack || project.techStack || []).join(', '))}"></div>
        <div class="portfolio-control"><label>Features (comma-separated)</label><textarea data-project-field="keyFeatures">${escapeHtml((override.keyFeatures || project.keyFeatures || []).join(', '))}</textarea></div>
        <div class="portfolio-control"><label>Metrics (one per line: value | label)</label><textarea data-project-field="impactMetrics">${escapeHtml(override.impactMetrics || metricText(project))}</textarea></div>
        <div class="portfolio-control"><label>Desktop screenshot path</label><input type="text" data-project-screenshot="desktop" value="${escapeAttr((override.screenshots || {}).desktop ?? project.screenshots?.desktop ?? '')}" placeholder="/project-studio-assets/portfolio-screenshots/${escapeAttr(project.slug)}/desktop.png"></div>
        <div class="portfolio-control"><label>Mobile screenshot path</label><input type="text" data-project-screenshot="mobile" value="${escapeAttr((override.screenshots || {}).mobile ?? project.screenshots?.mobile ?? '')}" placeholder="/project-studio-assets/portfolio-screenshots/${escapeAttr(project.slug)}/mobile.png"></div>
        <div class="portfolio-control"><label>Tablet screenshot path</label><input type="text" data-project-screenshot="tablet" value="${escapeAttr((override.screenshots || {}).tablet ?? project.screenshots?.tablet ?? '')}" placeholder="/project-studio-assets/portfolio-screenshots/${escapeAttr(project.slug)}/tablet.png"></div>
      </fieldset>
    `;
  }

  function renderTemplateRail() {
    templateRail.hidden = true;
    templateRail.innerHTML = '';
  }

  function metadataHtml(project) {
    if (!settings.showMetadata) return '';
    return `<div class="portfolio-tags">
      <span class="portfolio-tag">${escapeHtml(project.category)}</span>
      <span class="portfolio-tag">${escapeHtml(project.status)}</span>
      <span class="portfolio-tag">${escapeHtml(project.year)}</span>
      <span class="portfolio-tag">${escapeHtml(project.client || '')}</span>
    </div>`;
  }

  function tagsHtml(project) {
    if (!settings.showTags || !project.tags?.length) return '';
    return `<div class="portfolio-tags">${project.tags.map(tag => `<span class="portfolio-tag">${escapeHtml(tag)}</span>`).join('')}</div>`;
  }

  function stackHtml(project) {
    if (!settings.showTechStack || !project.techStack?.length) return '';
    return `<div class="portfolio-stack">${project.techStack.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>`;
  }

  function metricsHtml(project, limit = 3) {
    if (!settings.showMetrics || !project.impactMetrics?.length) return '';
    return `<div class="portfolio-metrics">${project.impactMetrics.slice(0, limit).map(metric => `<div class="portfolio-metric"><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`).join('')}</div>`;
  }

  function featuresHtml(project, limit = 4) {
    if (!project.keyFeatures?.length) return '';
    return `<div class="portfolio-features">${project.keyFeatures.slice(0, limit).map(item => `<span class="portfolio-feature">${escapeHtml(item)}</span>`).join('')}</div>`;
  }

  function descriptionHtml(project) {
    if (!settings.showDescriptions) return '';
    return `<p class="project-description">${escapeHtml(project.description)}</p>`;
  }

  function screenshotPath(project, kind) {
    const src = project.screenshots?.[kind] || '';
    if (src) return src;
    if (kind === 'desktop' && project.previewImages?.[0]) return project.previewImages[0];
    return '';
  }

  function screenshotFrame(project, kind = 'desktop', options = {}) {
    const frameStyle = options.frameStyle || (kind === 'mobile' ? 'phone' : settings.screenshotFrameStyle || 'browser');
    const src = screenshotPath(project, kind);
    const chrome = frameStyle === 'raw' || frameStyle === 'phone' ? '' : '<div class="frame-chrome"><span></span><span></span><span></span></div>';
    const hidden = src ? 'hidden' : '';
    const img = src ? `<img data-screenshot-image src="${escapeAttr(src)}" alt="${escapeAttr(project.name)} ${escapeAttr(kind)} screenshot" loading="lazy" decoding="async">` : '';
    return `<figure class="screenshot-frame screenshot-frame--${escapeAttr(frameStyle)} screenshot-frame--${escapeAttr(kind)}" style="--project-accent:${escapeAttr(project.accentColor || '#72efc5')}" data-shadow="${escapeAttr(settings.imageShadowIntensity || 'strong')}">
      ${chrome}
      <div class="frame-image-wrap">
        ${img}
        <div class="screenshot-placeholder" ${hidden}><div><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.category)} preview pending</span></div></div>
      </div>
    </figure>`;
  }

  function projectIntro(project) {
    return `<div class="project-copy">
      ${metadataHtml(project)}
      <h3 class="project-title">${escapeHtml(project.name)}</h3>
      <p class="project-headline">${escapeHtml(project.headline)}</p>
      ${descriptionHtml(project)}
      ${featuresHtml(project)}
      ${stackHtml(project)}
      ${tagsHtml(project)}
    </div>`;
  }

  function renderCinematic(list, featured) {
    const others = list.filter(project => project.slug !== featured.slug).slice(0, 6);
    return `<article class="portfolio-page tpl-cinematic" ${pageAttrs()}>
      <div class="portfolio-inner">
        <section class="hero-layout">
          <div>
            <p class="portfolio-hero-kicker">${escapeHtml(settings.studioName)}</p>
            <h1 class="portfolio-title">${escapeHtml(settings.title)}</h1>
            <p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p>
            <p class="portfolio-description">${escapeHtml(settings.intro)}</p>
            ${metricsHtml(featured, 1)}
          </div>
          <div class="featured-screens">
            ${screenshotFrame(featured, 'desktop', { frameStyle: 'browser' })}
            ${screenshotFrame(featured, 'mobile', { frameStyle: 'phone' })}
          </div>
        </section>
        <section class="project-card" style="--project-accent:${escapeAttr(featured.accentColor)}">${projectIntro(featured)}</section>
        <section class="project-strip">${others.map(project => `<article class="strip-card" style="--project-accent:${escapeAttr(project.accentColor)}"><span class="portfolio-meta-label">${escapeHtml(project.category)}</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.summary)}</p></article>`).join('')}</section>
      </div>
    </article>`;
  }

  function renderEditorial(list) {
    return `<article class="portfolio-page tpl-editorial" ${pageAttrs('editorial-paper')}>
      <div class="portfolio-inner">
        <p class="portfolio-hero-kicker">${escapeHtml(settings.studioName)}</p>
        <h1 class="portfolio-title">${escapeHtml(settings.title)}</h1>
        <p class="portfolio-subtitle">${escapeHtml(settings.intro)}</p>
        <blockquote class="pull-quote">Designed as working interfaces, not static presentations.</blockquote>
        ${list.slice(0, 8).map(project => `<section class="case-card" style="--project-accent:${escapeAttr(project.accentColor)}"><div>${projectIntro(project)}${metricsHtml(project, 2)}</div>${screenshotFrame(project, 'desktop', { frameStyle: 'raw' })}</section>`).join('')}
      </div>
    </article>`;
  }

  function renderDeviceGrid(list) {
    return `<article class="portfolio-page tpl-device-grid" ${pageAttrs('gradient')}><div class="portfolio-inner"><header><p class="portfolio-hero-kicker">Device showcase</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p></header><section class="portfolio-grid portfolio-grid--3">${list.map(project => `<article class="project-card device-card" style="--project-accent:${escapeAttr(project.accentColor)}"><div class="device-pair">${screenshotFrame(project, 'desktop', { frameStyle: 'browser' })}${screenshotFrame(project, 'mobile', { frameStyle: 'phone' })}</div>${projectIntro(project)}${metricsHtml(project, 2)}</article>`).join('')}</section></div></article>`;
  }

  function renderGlass(list) {
    return `<article class="portfolio-page tpl-glass-system" ${pageAttrs('radial-glow')}><div class="portfolio-inner"><p class="portfolio-hero-kicker">Floating system</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.intro)}</p><section class="glass-cloud">${list.map(project => `<article class="project-card glass-card" style="--project-accent:${escapeAttr(project.accentColor)}">${screenshotFrame(project, 'desktop', { frameStyle: 'glass' })}${projectIntro(project)}${metricsHtml(project, 1)}</article>`).join('')}</section></div></article>`;
  }

  function renderBrutalist(list) {
    return `<article class="portfolio-page tpl-brutalist" data-theme="light" data-density="${escapeAttr(settings.density)}" data-width="${escapeAttr(settings.pageWidth)}" data-type="${escapeAttr(settings.typographyScale)}" data-motion="${escapeAttr(settings.animationLevel)}"><div class="portfolio-inner"><p class="portfolio-hero-kicker">Product index</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p>${list.map((project, index) => `<section class="index-row" style="--project-accent:${escapeAttr(project.accentColor)}"><div class="index-number">${String(index + 1).padStart(2, '0')}</div><div><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.summary)}</p></div><div>${metadataHtml(project)}${featuresHtml(project, 3)}${stackHtml(project)}</div><div>${metricsHtml(project, 1)}</div></section>`).join('')}</div></article>`;
  }

  function renderInvestor(list) {
    return `<article class="portfolio-page tpl-investor" ${pageAttrs('solid')}><div class="portfolio-inner"><p class="portfolio-hero-kicker">Investor deck</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p>${list.slice(0, 9).map(project => `<section class="deck-slide" style="--project-accent:${escapeAttr(project.accentColor)}"><div class="deck-grid"><div>${metadataHtml(project)}<h2 class="project-title">${escapeHtml(project.name)}</h2><p class="project-headline">${escapeHtml(project.headline)}</p><div class="deck-columns"><div class="deck-pill"><span class="portfolio-meta-label">Problem</span><p>${escapeHtml(project.summary)}</p></div><div class="deck-pill"><span class="portfolio-meta-label">Solution</span><p>${escapeHtml(project.description)}</p></div></div>${metricsHtml(project, 2)}${featuresHtml(project)}</div>${screenshotFrame(project, 'desktop', { frameStyle: 'monitor' })}</div></section>`).join('')}</div></article>`;
  }

  function renderMobileFirst(list) {
    return `<article class="portfolio-page tpl-mobile-first" ${pageAttrs('radial-glow')}><div class="portfolio-inner"><p class="portfolio-hero-kicker">Mobile-first showcase</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p><section class="phone-wall">${list.map(project => `<article class="phone-card" style="--project-accent:${escapeAttr(project.accentColor)}">${screenshotFrame(project, 'mobile', { frameStyle: 'phone' })}${projectIntro(project)}${metricsHtml(project, 1)}</article>`).join('')}</section></div></article>`;
  }

  function renderCommandCenter(list, featured) {
    return `<article class="portfolio-page tpl-command-center" ${pageAttrs('grid')}><div class="portfolio-inner"><p class="portfolio-hero-kicker">Desktop command center</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.intro)}</p><section class="command-layout"><div>${screenshotFrame(featured, 'desktop', { frameStyle: 'monitor' })}</div><aside class="command-card">${projectIntro(featured)}${metricsHtml(featured, 3)}</aside></section><section class="command-list">${list.filter(project => project.slug !== featured.slug).map(project => `<article class="command-card" style="--project-accent:${escapeAttr(project.accentColor)}"><div class="portfolio-grid portfolio-grid--2"><div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.summary)}</p>${metadataHtml(project)}</div>${screenshotFrame(project, 'desktop', { frameStyle: 'browser' })}</div></article>`).join('')}</section></div></article>`;
  }

  function renderGallery(list) {
    return `<article class="portfolio-page tpl-gallery" ${pageAttrs('cinematic-dark')}><div class="portfolio-inner"><p class="portfolio-hero-kicker">Gallery mode</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p>${list.map(project => `<section class="gallery-exhibit" style="--project-accent:${escapeAttr(project.accentColor)}"><div>${screenshotFrame(project, 'desktop', { frameStyle: 'raw' })}</div><aside class="gallery-plaque">${metadataHtml(project)}<h2 class="project-title">${escapeHtml(project.name)}</h2><p class="project-headline">${escapeHtml(project.headline)}</p>${descriptionHtml(project)}${tagsHtml(project)}${metricsHtml(project, 2)}</aside></section>`).join('')}</div></article>`;
  }

  function renderAgency(list, featured) {
    const selected = list.slice(0, 6);
    return `<article class="portfolio-page tpl-agency" ${pageAttrs('gradient')}><div class="portfolio-inner"><section class="agency-hero"><div><p class="portfolio-hero-kicker">${escapeHtml(settings.studioName)}</p><h1 class="portfolio-title">${escapeHtml(settings.title)}</h1><p class="portfolio-subtitle">${escapeHtml(settings.intro)}</p>${tagsHtml(featured)}</div>${screenshotFrame(featured, 'desktop', { frameStyle: 'browser' })}</section><section class="selected-work">${selected.map(project => `<article class="project-card" style="--project-accent:${escapeAttr(project.accentColor)}">${screenshotFrame(project, 'desktop', { frameStyle: 'glass' })}<h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.summary)}</p>${metadataHtml(project)}${metricsHtml(project, 1)}</article>`).join('')}</section><footer class="agency-footer"><strong>${escapeHtml(settings.studioName)}</strong><span>${escapeHtml(settings.footerText)}</span></footer></div></article>`;
  }

  function templateName(templateId) {
    return templates.find(template => template.id === templateId)?.name || templateId || 'Cinematic Hero Wall';
  }

  function projectTemplate(project, index) {
    settings.projectTemplates ||= {};
    const selected = settings.projectTemplates[project.slug];
    if (selected && templates.some(template => template.id === selected)) return selected;
    if (settings.template && templates.some(template => template.id === settings.template)) return settings.template;
    return templates[index % Math.max(templates.length, 1)]?.id || 'cinematic';
  }

  function projectTemplateSelector(project, selectedTemplate) {
    return `<label class="panel-look-selector">
      <span>Look</span>
      <select data-project-template="${escapeAttr(project.slug)}" aria-label="Template for ${escapeAttr(project.name)}">
        ${templates.map(template => `<option value="${escapeAttr(template.id)}" ${template.id === selectedTemplate ? 'selected' : ''}>${escapeHtml(template.name)}</option>`).join('')}
      </select>
    </label>`;
  }

  function panelShell(project, index, templateId, bodyHtml, options = {}) {
    const number = String(index + 1).padStart(2, '0');
    const label = options.label || templateName(templateId);
    return `<section class="portfolio-project-panel panel-${escapeAttr(templateId)}" style="--project-accent:${escapeAttr(project.accentColor || '#72efc5')}" data-panel-template="${escapeAttr(templateId)}" data-project="${escapeAttr(project.slug)}">
      <div class="panel-topline">
        <span>${number}</span>
        <span>${escapeHtml(project.category || 'Project')}</span>
        <span>${escapeHtml(label)}</span>
      </div>
      ${projectTemplateSelector(project, templateId)}
      ${bodyHtml}
    </section>`;
  }

  function panelIntroBlock(project, headingTag = 'h2') {
    return `<div class="panel-copy">
      ${metadataHtml(project)}
      <${headingTag} class="project-title">${escapeHtml(project.name)}</${headingTag}>
      <p class="project-headline">${escapeHtml(project.headline)}</p>
      <p class="project-summary">${escapeHtml(project.summary)}</p>
      ${descriptionHtml(project)}
      ${featuresHtml(project, 4)}
      ${tagsHtml(project)}
    </div>`;
  }

  function renderPanelCinematic(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--hero">
        ${panelIntroBlock(project)}
        <div class="panel-screen-stack">
          ${screenshotFrame(project, 'desktop', { frameStyle: 'raw' })}
          ${screenshotFrame(project, 'mobile', { frameStyle: 'phone' })}
        </div>
      </div>
      ${metricsHtml(project, 3)}
    `);
  }

  function renderPanelEditorial(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--editorial">
        <div>
          <p class="portfolio-hero-kicker">${escapeHtml(project.role || settings.studioName)}</p>
          <h2 class="project-title">${escapeHtml(project.headline)}</h2>
          <blockquote class="panel-quote">Designed as a working interface, not a static presentation.</blockquote>
          ${descriptionHtml(project)}
        </div>
        <div>
          ${screenshotFrame(project, 'desktop', { frameStyle: 'raw' })}
          ${featuresHtml(project, 5)}
        </div>
      </div>
    `);
  }

  function renderPanelDevice(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--device">
        <div class="panel-device-copy">${panelIntroBlock(project)}${metricsHtml(project, 2)}</div>
        <div class="panel-device-wall">
          ${screenshotFrame(project, 'desktop', { frameStyle: 'browser' })}
          ${screenshotFrame(project, 'tablet', { frameStyle: 'device' })}
          ${screenshotFrame(project, 'mobile', { frameStyle: 'phone' })}
        </div>
      </div>
    `);
  }

  function renderPanelGlass(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--glass">
        ${screenshotFrame(project, 'desktop', { frameStyle: 'glass' })}
        <div class="panel-glass-note">${panelIntroBlock(project)}${stackHtml(project)}${metricsHtml(project, 2)}</div>
      </div>
    `);
  }

  function renderPanelBrutalist(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--index">
        <div class="panel-index-number">${String(index + 1).padStart(2, '0')}</div>
        <div>
          <h2 class="project-title">${escapeHtml(project.name)}</h2>
          <p class="project-headline">${escapeHtml(project.summary)}</p>
        </div>
        <div>${metadataHtml(project)}${featuresHtml(project, 4)}${stackHtml(project)}</div>
        <div>${metricsHtml(project, 2)}</div>
      </div>
    `);
  }

  function renderPanelInvestor(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--deck">
        <div>
          <h2 class="project-title">${escapeHtml(project.name)}</h2>
          <p class="project-headline">${escapeHtml(project.headline)}</p>
          <div class="panel-deck-columns">
            <div><span class="portfolio-meta-label">Product surface</span><p>${escapeHtml(project.summary)}</p></div>
            <div><span class="portfolio-meta-label">Operating value</span><p>${escapeHtml(project.description)}</p></div>
          </div>
          ${metricsHtml(project, 3)}
        </div>
        ${screenshotFrame(project, 'desktop', { frameStyle: 'monitor' })}
      </div>
    `);
  }

  function renderPanelMobile(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--mobile">
        <div class="panel-phone-focus">${screenshotFrame(project, 'mobile', { frameStyle: 'phone' })}</div>
        <div>${panelIntroBlock(project)}${metricsHtml(project, 2)}${stackHtml(project)}</div>
      </div>
    `);
  }

  function renderPanelCommand(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--command">
        ${screenshotFrame(project, 'desktop', { frameStyle: 'monitor' })}
        <aside>
          ${panelIntroBlock(project)}
          ${metricsHtml(project, 3)}
          ${stackHtml(project)}
        </aside>
      </div>
    `);
  }

  function renderPanelGallery(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--gallery">
        ${screenshotFrame(project, 'desktop', { frameStyle: 'raw' })}
        <aside class="panel-plaque">
          ${metadataHtml(project)}
          <h2 class="project-title">${escapeHtml(project.name)}</h2>
          <p class="project-headline">${escapeHtml(project.headline)}</p>
          ${descriptionHtml(project)}
          ${tagsHtml(project)}
        </aside>
      </div>
    `);
  }

  function renderPanelAgency(project, index, templateId) {
    return panelShell(project, index, templateId, `
      <div class="panel-layout panel-layout--agency">
        <div>
          <p class="portfolio-hero-kicker">${escapeHtml(settings.studioName)}</p>
          ${panelIntroBlock(project)}
          ${featuresHtml(project, 5)}
        </div>
        <div class="panel-agency-media">${screenshotFrame(project, 'desktop', { frameStyle: 'browser' })}</div>
      </div>
    `);
  }

  function renderProjectPanel(project, index) {
    const templateId = projectTemplate(project, index);
    if (templateId === 'editorial') return renderPanelEditorial(project, index, templateId);
    if (templateId === 'device-grid') return renderPanelDevice(project, index, templateId);
    if (templateId === 'glass-system') return renderPanelGlass(project, index, templateId);
    if (templateId === 'brutalist') return renderPanelBrutalist(project, index, templateId);
    if (templateId === 'investor') return renderPanelInvestor(project, index, templateId);
    if (templateId === 'mobile-first') return renderPanelMobile(project, index, templateId);
    if (templateId === 'command-center') return renderPanelCommand(project, index, templateId);
    if (templateId === 'gallery') return renderPanelGallery(project, index, templateId);
    if (templateId === 'agency') return renderPanelAgency(project, index, templateId);
    return renderPanelCinematic(project, index, templateId);
  }

  function renderPortfolioDeck(list) {
    return `<article class="portfolio-page portfolio-page--cinematic-spa" ${pageAttrs('cinematic-dark')}>
      <header class="portfolio-cover">
        <p class="portfolio-hero-kicker">${escapeHtml(settings.studioName)}</p>
        <h1 class="portfolio-title">${escapeHtml(settings.title)}</h1>
        <p class="portfolio-subtitle">${escapeHtml(settings.subtitle)}</p>
        <p class="portfolio-description">${escapeHtml(settings.intro)}</p>
      </header>
      <div class="portfolio-panel-sequence">
        ${list.map((project, index) => renderProjectPanel(project, index)).join('')}
      </div>
      <footer class="portfolio-closing">
        <strong>${escapeHtml(settings.studioName)}</strong>
        <span>${escapeHtml(settings.footerText)}</span>
      </footer>
    </article>`;
  }

  function pageAttrs(forcedBg) {
    const palette = paletteMap[settings.accentPalette] || paletteMap['cyan-emerald'];
    const radius = settings.radiusScale === 'sharp' ? '10px' : settings.radiusScale === 'round' ? '42px' : '28px';
    const bg = forcedBg || settings.backgroundStyle || 'cinematic-dark';
    const theme = settings.themeMode === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.themeMode;
    return `style="--portfolio-accent:${escapeAttr(palette[1])};--portfolio-accent-2:${escapeAttr(palette[0])};--portfolio-radius:${escapeAttr(radius)}" data-theme="${escapeAttr(theme)}" data-bg="${escapeAttr(bg)}" data-density="${escapeAttr(settings.density)}" data-width="${escapeAttr(settings.pageWidth)}" data-type="${escapeAttr(settings.typographyScale)}" data-motion="${escapeAttr(settings.animationLevel)}"`;
  }

  function renderPortfolio() {
    const list = visibleProjects();
    stageTitle.textContent = settings.title || 'Project Studio Portfolio';
    stageMeta.innerHTML = `<span>${list.length} panels</span><span>Per-project looks</span>`;
    let html = '';
    if (!list.length) {
      html = `<article class="portfolio-page" ${pageAttrs()}><div class="portfolio-inner"><p class="portfolio-hero-kicker">Portfolio</p><h1 class="portfolio-title">No visible projects</h1><p class="portfolio-subtitle">Add a project in Studio, or use the project editor to show a hidden project.</p></div></article>`;
    } else {
      html = renderPortfolioDeck(list);
    }
    previewRoot.innerHTML = html;
  }

  function renderAll() {
    renderTemplateRail();
    renderSettings();
    renderPortfolio();
  }

  function setMode(mode) {
    const next = mode === 'portfolio' ? 'portfolio' : 'studio';
    localStorage.setItem(modeStorageKey, next);
    document.querySelectorAll('[data-app-mode]').forEach(button => {
      const active = button.dataset.appMode === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    studioMode.hidden = next !== 'studio';
    portfolioMode.hidden = next !== 'portfolio';
    requestAnimationFrame(() => {
      studioMode.classList.toggle('mode-view--active', next === 'studio');
      portfolioMode.classList.toggle('mode-view--active', next === 'portfolio');
    });
    if (next === 'portfolio') renderAll();
  }

  function ensureOverride(slug) {
    settings.projectOverrides ||= {};
    settings.projectOverrides[slug] ||= {};
    return settings.projectOverrides[slug];
  }

  settingsRoot.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.setting) {
      settings[target.dataset.setting] = target.type === 'checkbox' ? target.checked : target.value;
      saveSettings();
      renderPortfolio();
      return;
    }
    if (target.dataset.projectField) {
      const override = ensureOverride(editorSlug);
      override[target.dataset.projectField] = target.value;
      saveSettings();
      renderPortfolio();
      return;
    }
    if (target.dataset.projectScreenshot) {
      const override = ensureOverride(editorSlug);
      override.screenshots ||= {};
      override.screenshots[target.dataset.projectScreenshot] = target.value.trim();
      saveSettings();
      renderPortfolio();
    }
  });

  settingsRoot.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.dataset.projectSelect) {
      editorSlug = target.value;
      renderSettings();
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.setting) {
      settings[target.dataset.setting] = target.value;
      saveSettings();
      renderSettings();
      renderTemplateRail();
      renderPortfolio();
    }
  });

  settingsRoot.addEventListener('click', event => {
    const choice = event.target.closest('[data-setting-choice]');
    if (choice) {
      settings[choice.dataset.settingChoice] = choice.dataset.value;
      saveSettings();
      renderSettings();
      renderPortfolio();
      return;
    }
    const toggle = event.target.closest('[data-project-toggle]');
    if (!toggle) return;
    if (toggle.dataset.projectToggle === 'featured') {
      settings.featuredSlug = editorSlug;
    } else {
      const hidden = new Set(settings.hiddenProjects || []);
      if (hidden.has(editorSlug)) hidden.delete(editorSlug); else hidden.add(editorSlug);
      settings.hiddenProjects = [...hidden];
    }
    saveSettings();
    renderSettings();
    renderPortfolio();
  });

  templateRail.addEventListener('click', event => {
    const button = event.target.closest('[data-template]');
    if (!button) return;
    settings.template = button.dataset.template;
    saveSettings();
    renderTemplateRail();
    renderSettings();
    renderPortfolio();
  });

  previewRoot.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.dataset.projectTemplate) return;
    settings.projectTemplates ||= {};
    settings.projectTemplates[target.dataset.projectTemplate] = target.value;
    saveSettings();
    renderPortfolio();
  });

  document.addEventListener('click', event => {
    const modeButton = event.target.closest('[data-app-mode]');
    if (!modeButton) return;
    event.preventDefault();
    setMode(modeButton.dataset.appMode);
  });

  resetButton?.addEventListener('click', () => {
    settings = clone(defaults);
    editorSlug = settings.featuredSlug || projects[0]?.slug || '';
    saveSettings();
    renderAll();
  });

  previewRoot.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches('[data-screenshot-image]')) return;
    image.hidden = true;
    const placeholder = image.parentElement?.querySelector('.screenshot-placeholder');
    if (placeholder) placeholder.hidden = false;
  }, true);

  setMode(localStorage.getItem(modeStorageKey) === 'portfolio' ? 'portfolio' : 'studio');
})();
