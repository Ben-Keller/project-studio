// Portable preferences live in the workspace; browser storage is an offline cache.
window.studioPreferences = (() => {
  const allowed = new Set(['projectStudioPinnedTools','projectStudioActivityGroups','projectStudioManualOrder',
    'projectStudioCompletionScores','projectStudioRenamedTools','projectStudioSelectedVersions',
    'projectStudioLastOpened','projectStudioPortfolioSettings','projectStudioMode']);
  const values = JSON.parse(document.getElementById('studioPreferences')?.textContent || '{}');
  let timer;
  for (const key of allowed) {
    if (!(key in values)) { try { const value=localStorage.getItem(key); if(value!==null)values[key]=value; } catch {} }
  }
  async function save() {
    try {
      const response=await fetch('/api/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values),keepalive:true});
      if(!response.ok)throw new Error('Workspace preferences could not be saved');
      document.getElementById('preferenceSaveError')?.remove();
    } catch {
      if(!document.getElementById('preferenceSaveError')) {
        const notice=document.createElement('p');notice.id='preferenceSaveError';notice.role='status';
        notice.textContent='Preferences are not saved to the workspace. Keep this window open and reload when the service is available.';
        document.body.prepend(notice);
      }
    }
  }
  function schedule() { clearTimeout(timer);timer=setTimeout(save,300); }
  schedule();
  return {getItem:key=>values[key]??null,setItem(key,value) {
    if(!allowed.has(key))throw new Error('Unsupported preference');
    values[key]=String(value);try {localStorage.setItem(key,String(value));} catch {} schedule();
  }, removeItem(key) { delete values[key];try {localStorage.removeItem(key);} catch {} schedule(); }};
})();
const studioDataNode = document.getElementById('studioData');
window.__INITIAL_APPS__ = studioDataNode
  ? JSON.parse(studioDataNode.textContent || '{\"apps\":[]}')
  : { apps: [] };
const cardList = [...document.querySelectorAll('.tool-card')];
    const cards = new Map(cardList.map(card => [card.dataset.slug, card]));
    const grid = document.getElementById('grid');
        const summary = document.getElementById('summary');
        const sortControls = document.getElementById('sortControls');
        const studioSearch = document.getElementById('studioSearch');
        const agencyControls = document.getElementById('agencyControls');
        const tagControls = document.getElementById('tagControls');
        const activeDivider = document.getElementById('activeDivider');
        const inactiveDivider = document.getElementById('inactiveDivider');
        const resourceAdvisor = document.getElementById('resourceAdvisor');
        const resourceAdvisorToggle = document.getElementById('resourceAdvisorToggle');
        const resourceAdvisorSummary = document.getElementById('resourceAdvisorSummary');
        const resourceAdvisorPanel = document.getElementById('resourceAdvisorPanel');
        const resourceAdvisorList = document.getElementById('resourceAdvisorList');
        const detailModal = document.getElementById('detailModal');
        const detailVisual = document.getElementById('detailVisual');
        const detailLogo = document.getElementById('detailLogo');
        const detailPhotos = document.getElementById('detailPhotos');
        const detailPhotoViewer = document.getElementById('detailPhotoViewer');
        const detailPhotoViewerImage = document.getElementById('detailPhotoViewerImage');
        const detailPhotoViewerLabel = document.getElementById('detailPhotoViewerLabel');
        const detailPhotoViewerClose = document.getElementById('detailPhotoViewerClose');
        const detailTitle = document.getElementById('detailTitle');
        const detailTitleText = document.getElementById('detailTitleText');
        const detailKind = document.getElementById('detailKind');
        const detailStatus = document.getElementById('detailStatus');
        const detailNote = document.getElementById('detailNote');
        const detailDescription = document.getElementById('detailDescription');
        const detailDiagnostic = document.getElementById('detailDiagnostic');
        const detailGroup = document.getElementById('detailGroup');
        const detailEndpoint = document.getElementById('detailEndpoint');
        const detailCompletion = document.getElementById('detailCompletion');
        const detailUpdated = document.getElementById('detailUpdated');
        const detailRole = document.getElementById('detailRole');
        const detailChipCloud = document.getElementById('detailChipCloud');
        const detailLaunch = document.getElementById('detailLaunch');
        const detailVersion = document.getElementById('detailVersion');
        const detailVersionWrap = document.getElementById('detailVersionWrap');
        const detailStar = document.getElementById('detailStar');
        const detailActivity = document.getElementById('detailActivity');
        const detailDocs = document.getElementById('detailDocs');
        const detailDocDownload = document.getElementById('detailDocDownload');
        const detailPdf = document.getElementById('detailPdf');
        const detailFolder = document.getElementById('detailFolder');
        const detailLogs = document.getElementById('detailLogs');
        const detailStop = document.getElementById('detailStop');
        const detailRename = document.getElementById('detailRename');
        const detailRenameRow = document.getElementById('detailRenameRow');
        const detailRenameToggle = document.getElementById('detailRenameToggle');
        const detailRenameSave = document.getElementById('detailRenameSave');
        const detailRenameCancel = document.getElementById('detailRenameCancel');
        const docViewer = document.getElementById('docViewer');
        const docContent = document.getElementById('docContent');
        const docClose = document.getElementById('docClose');
        const pinStorageKey = 'projectStudioPinnedTools';
        const activityStorageKey = 'projectStudioActivityGroups';
        const orderStorageKey = 'projectStudioManualOrder';
        const completionStorageKey = 'projectStudioCompletionScores';
        const nameStorageKey = 'projectStudioRenamedTools';
        const versionStorageKey = 'projectStudioSelectedVersions';
        const lastOpenedStorageKey = 'projectStudioLastOpened';
        const manualGroups = ['active:pinned', 'active:unpinned', 'inactive:pinned', 'inactive:unpinned'];
        let selectedDetailCard = null;
        let detailMediaKey = '';
        function loadActivityGroups() {
          try {
            const parsed = JSON.parse(window.studioPreferences.getItem(activityStorageKey) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch (error) {
            return {};
          }
        }
        function loadManualOrder() {
          try {
            const parsed = JSON.parse(window.studioPreferences.getItem(orderStorageKey) || '{}');
            return Object.fromEntries(manualGroups.map(group => {
              if (Array.isArray(parsed[group])) return [group, parsed[group]];
              if (group === 'active:pinned' && Array.isArray(parsed.pinned)) return [group, parsed.pinned];
              if (group === 'active:unpinned' && Array.isArray(parsed.unpinned)) return [group, parsed.unpinned];
              return [group, []];
            }));
          } catch (error) {
            return Object.fromEntries(manualGroups.map(group => [group, []]));
          }
        }
        function loadCompletionScores() {
          try {
            const parsed = JSON.parse(window.studioPreferences.getItem(completionStorageKey) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch (error) {
            return {};
          }
        }
        function loadRenames() {
          try {
            const parsed = JSON.parse(window.studioPreferences.getItem(nameStorageKey) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch (error) {
            return {};
          }
        }


        function loadLastOpened() {
          try {
            const parsed = JSON.parse(window.studioPreferences.getItem(lastOpenedStorageKey) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch (error) {
            return {};
          }
        }


        function loadSelectedVersions() {
          try {
            const parsed = JSON.parse(window.studioPreferences.getItem(versionStorageKey) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch (error) {
            return {};
          }
        }

        const RECENT_REORDER_DELAY_MS = 12000;

        const state = {
          mode: 'all',
          agency: 'all',
          tag: 'all',
          query: '',
          sort: 'modified',
          resourceSort: 'cpu',
          resourceSortDirection: -1,
          sortDirection: -1,
          pins: new Set(JSON.parse(window.studioPreferences.getItem(pinStorageKey) || '[]')),
          activity: loadActivityGroups(),
          manualOrder: loadManualOrder(),
          completion: loadCompletionScores(),
          names: loadRenames(),
          lastOpened: loadLastOpened(),
          versions: loadSelectedVersions(),
          deferRecentReorderUntil: 0,
          frozenRecentOrders: null,
        };
        const dragState = {
          card: null,
          preview: null,
          pointerId: null,
          pointerX: 0,
          pointerY: 0,
          startX: 0,
          startY: 0,
          offsetX: 0,
          offsetY: 0,
          moved: false,
          frame: null,
          target: null,
          afterTarget: false,
          dropActivity: null,
          noopDrop: false,
          dropLine: null,
          layoutRects: [],
        };
        let detailReturnFocus = null;

        function savePins() {
          window.studioPreferences.setItem(pinStorageKey, JSON.stringify([...state.pins]));
        }

        function saveActivityGroups() {
          window.studioPreferences.setItem(activityStorageKey, JSON.stringify(state.activity));
        }

        function saveManualOrder() {
          window.studioPreferences.setItem(orderStorageKey, JSON.stringify(state.manualOrder));
        }

        function saveCompletionScores() {
          window.studioPreferences.setItem(completionStorageKey, JSON.stringify(state.completion));
        }

        function saveRenames() {
          window.studioPreferences.setItem(nameStorageKey, JSON.stringify(state.names));
        }


        function saveLastOpened() {
          window.studioPreferences.setItem(lastOpenedStorageKey, JSON.stringify(state.lastOpened));
        }


        function saveSelectedVersions() {
          window.studioPreferences.setItem(versionStorageKey, JSON.stringify(state.versions));
        }

        function versionOptionsForCard(card) {
          try {
            const parsed = JSON.parse(card.dataset.detailVersions || '[]');
            return Array.isArray(parsed) ? parsed.filter(item => item && item.id && item.label) : [];
          } catch (error) {
            return [];
          }
        }

        function selectedVersionForCard(card) {
          const options = versionOptionsForCard(card);
          if (!options.length) return null;
          const valid = new Set(options.map(item => item.id));
          const fallback = card.dataset.detailDefaultVersion || options[0].id;
          const saved = state.versions[card.dataset.slug];
          const selected = valid.has(saved) ? saved : (valid.has(fallback) ? fallback : options[0].id);
          return options.find(item => item.id === selected) || options[0];
        }




        function launchUrlForCard(card) {
          const launchUrl = card.dataset.detailLaunchUrl || '';
          if (!launchUrl || card.dataset.detailDisabled === 'true') return '#';
          const slug = card.dataset.slug;
          const params = new URLSearchParams();
          const version = selectedVersionForCard(card);
          if (version) params.set('version', version.id);
          const query = params.toString();
          const target = card.dataset.detailStatic === 'true'
            ? `/links/${encodeURIComponent(slug)}/open`
            : launchUrl;
          return query ? `${target}${target.includes('?') ? '&' : '?'}${query}` : target;
        }

        function launchWindowNameForCard(card) {
          const slug = (card?.dataset?.slug || 'app').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
          const version = selectedVersionForCard(card)?.id || '';
          return `project-studio-app-${slug}${version ? `-${version}` : ''}`;
        }

        function openLaunchUrlForCard(card) {
          const url = launchUrlForCard(card);
          if (!card || !url || url === '#') return false;
          markCardOpened(card);
          window.studioAction(url, launchWindowNameForCard(card));
          return true;
        }

        function syncCardLaunchLink(card) {
          const controls = [...card.querySelectorAll('[data-launch-control]')];
          if (!controls.length) return;
          const isStatic = card.dataset.detailStatic === 'true';
          const version = selectedVersionForCard(card);
          controls.forEach(link => {
            const compact = link.dataset.launchKind === 'card';
            link.href = launchUrlForCard(card);
            link.textContent = version
              ? `View ${version.id.toUpperCase()}`
              : isStatic
                ? (compact ? 'Open' : 'Open website')
                : (compact ? 'Launch' : 'Launch app');
            link.removeAttribute('target');
            link.removeAttribute('rel');
          });
        }

        function displayNameForCard(card) {
          return state.names[card.dataset.slug] || card.dataset.detailName || card.dataset.slug;
        }

        function updateCardDisplayName(card) {
          const name = displayNameForCard(card);
          const title = card.querySelector('h2');
          if (title) title.textContent = name;
          card.dataset.name = name.toLowerCase();
          const action = card.querySelector('[data-open-detail]');
          if (action) action.setAttribute('aria-label', `View ${name}`);
        }

        function completionForCard(card) {
          const value = Number(state.completion[card.dataset.slug] || 0);
          return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.round(value))) : 0;
        }

        function updateCompletionMeter(card) {
          const meter = card.querySelector('[data-completion-meter]');
          if (!meter) return;
          const score = completionForCard(card);
          meter.dataset.score = String(score);
          meter.setAttribute('aria-label', `${card.dataset.detailName || card.dataset.slug} completion: ${score} of 5`);
          meter.querySelectorAll('[data-completion-value]').forEach(button => {
            const value = Number(button.dataset.completionValue || 0);
            const complete = value <= score;
            button.classList.toggle('is-complete', complete);
            button.setAttribute('aria-pressed', String(complete));
          });
        }

        function setCompletionForCard(card, value) {
          const score = Math.max(1, Math.min(5, Math.round(Number(value) || 1)));
          state.completion[card.dataset.slug] = score;
          saveCompletionScores();
          updateCompletionMeter(card);
          if (selectedDetailCard === card) refreshDetailModal(card);
        }

        function defaultActivityForCard(card) {
          return card.dataset.disabled === 'true' ? 'inactive' : 'active';
        }

        function activityForCard(card) {
          const activity = state.activity[card.dataset.slug];
          return activity === 'inactive' || activity === 'active' ? activity : defaultActivityForCard(card);
        }

        function setActivityForCard(card, activity) {
          const normalized = activity === 'inactive' ? 'inactive' : 'active';
          if (normalized === defaultActivityForCard(card)) {
            delete state.activity[card.dataset.slug];
          } else {
            state.activity[card.dataset.slug] = normalized;
          }
          saveActivityGroups();
        }

        function pinLaneForCard(card) {
          return state.pins.has(card.dataset.slug) ? 'pinned' : 'unpinned';
        }

        function groupForCard(card) {
          return `${activityForCard(card)}:${pinLaneForCard(card)}`;
        }

        function groupFor(activity, pinned) {
          return `${activity}:${pinned ? 'pinned' : 'unpinned'}`;
        }

        function normalizeManualOrder(group) {
          const slugs = cardList
            .filter(card => groupForCard(card) === group)
            .sort((a, b) => Number(a.dataset.order || 0) - Number(b.dataset.order || 0))
            .map(card => card.dataset.slug);
          const known = new Set(slugs);
          const current = (state.manualOrder[group] || []).filter(slug => known.has(slug));
          const currentSet = new Set(current);
          const missing = slugs.filter(slug => !currentSet.has(slug));
          state.manualOrder[group] = [...current, ...missing];
          return state.manualOrder[group];
        }

        function manualRank(card) {
          const order = normalizeManualOrder(groupForCard(card));
          const index = order.indexOf(card.dataset.slug);
          return index === -1 ? Number(card.dataset.order || 0) : index;
        }

        function groupRank(card) {
          const index = manualGroups.indexOf(groupForCard(card));
          return index === -1 ? manualGroups.length : index;
        }

        function defaultSortDirection(sort) {
          return sort === 'name' ? 1 : -1;
        }

        function updateSortButtons() {
          document.querySelectorAll('[data-sort]').forEach(item => {
            const active = item.dataset.sort === state.sort;
            item.classList.toggle('active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          const nameButton = document.querySelector('[data-sort="name"]');
          const modifiedButton = document.querySelector('[data-sort="modified"]');
          const createdButton = document.querySelector('[data-sort="created"]');
          if (nameButton) nameButton.textContent = state.sort === 'name' && state.sortDirection < 0 ? 'Z→A' : 'A→Z';
          if (modifiedButton) modifiedButton.textContent = state.sort === 'modified' && state.sortDirection > 0 ? 'Oldest' : 'Recent';
          if (createdButton) createdButton.textContent = state.sort === 'created' && state.sortDirection > 0 ? 'Oldest' : 'Newest';
        }

        function setSortMode(nextSort) {
          if (nextSort === state.sort && nextSort !== 'manual') {
            state.sortDirection *= -1;
          } else {
            state.sort = nextSort;
            state.sortDirection = nextSort === 'manual' ? 1 : defaultSortDirection(nextSort);
          }
          updateSortButtons();
        }

    function sortValue(card) {
      if (state.sort === 'name') return card.dataset.name || '';
      if (state.sort === 'created') return Number(card.dataset.created || 0);
      if (state.sort === 'modified') return lastOpenedForCard(card);
      return manualRank(card);
    }

        function compareCards(a, b) {
          if (state.sort === 'manual') {
            const groupDiff = groupRank(a) - groupRank(b);
            if (groupDiff) return groupDiff;
            return manualRank(a) - manualRank(b);
          }
          const aValue = sortValue(a);
          const bValue = sortValue(b);
      if (typeof aValue === 'string' || typeof bValue === 'string') {
        return String(aValue).localeCompare(String(bValue)) * state.sortDirection;
      }
      return (Number(aValue) - Number(bValue)) * state.sortDirection;
    }

    function normalizedSearchText(value) {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function cardSearchText(card) {
      if (!card.dataset.searchText) {
        const values = [
          card.dataset.slug,
          card.dataset.category,
          card.dataset.agency,
          card.dataset.groupLabel,
          card.dataset.tags,
          card.dataset.detailName,
          card.dataset.detailNote,
          card.dataset.detailDescription,
          card.dataset.detailHeadline,
          card.dataset.detailRole,
          card.dataset.detailTags,
          card.dataset.detailTech,
          card.dataset.detailKind,
          card.dataset.detailGroup,
          card.dataset.detailEndpoint,
          card.dataset.detailLaunchUrl,
          card.textContent,
        ];
        card.dataset.searchText = normalizedSearchText(values.filter(Boolean).join(' '));
      }
      return card.dataset.searchText;
    }

    function cardMatchesQuery(card) {
      const query = normalizedSearchText(state.query);
      if (!query) return true;
      const searchText = cardSearchText(card);
      return query.split(/\s+/).every(term => searchText.includes(term));
    }

    function cardVisible(card) {
      if (!cardMatchesQuery(card)) return false;
      if (state.tag !== 'all') {
        const tags = String(card.dataset.tags || '').split(/\s+/).filter(Boolean);
        if (!tags.includes(state.tag)) return false;
      }
      if (state.mode === 'all') return true;
      if (state.mode !== card.dataset.category) return false;
      if (state.mode === 'un' && state.agency !== 'all') return card.dataset.agency === state.agency;
      return true;
    }

    function formatEpoch(value) {
      const numeric = Number(value || 0);
      if (!numeric) return '-';
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(numeric * 1000));
    }

        function lastOpenedForCard(card) {
          const value = Number(state.lastOpened[card.dataset.slug] || 0);
          return Number.isFinite(value) ? value : 0;
        }

        function formatLastOpened(value) {
          const opened = Number(value || 0);
          if (!opened) return '';
          const elapsed = Math.max(1, Math.floor(Date.now() / 1000) - opened);
          if (elapsed < 60) return `${elapsed}s`;
          if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
          if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h`;
          if (elapsed < 604800) return `${Math.floor(elapsed / 86400)}d`;
          if (elapsed < 2629800) return `${Math.floor(elapsed / 604800)}w`;
          if (elapsed < 31557600) return `${Math.floor(elapsed / 2629800)}m`;
          return `${Math.floor(elapsed / 31557600)}y`;
        }

        function updateRecentLabel(card) {
          const label = card.querySelector('[data-role="recent-label"]');
          if (!label) return;
          const text = formatLastOpened(lastOpenedForCard(card));
          const showRecent = state.sort === 'modified' && Boolean(text);
          label.hidden = !showRecent;
          card.classList.toggle('show-recent', showRecent);
          label.textContent = showRecent ? text : '';
        }

        function recentReorderDeferred() {
          return state.sort === 'modified' && Date.now() < Number(state.deferRecentReorderUntil || 0);
        }

        function updateRecentLabelsOnly() {
          cardList.forEach(updateRecentLabel);
        }

        function freezeRecentOrder() {
          if (state.sort !== 'modified') return;
          const ordered = [...cardList]
            .filter(card => !card.classList.contains('hidden'))
            .sort((a, b) => Number(getComputedStyle(a).order || 0) - Number(getComputedStyle(b).order || 0));
          state.frozenRecentOrders = Object.fromEntries(
            ordered.map((card, index) => [card.dataset.slug, card.style.order || String(index)]),
          );
        }

        function restoreFrozenRecentOrder() {
          if (!state.frozenRecentOrders) return;
          cardList.forEach(card => {
            const frozenOrder = state.frozenRecentOrders[card.dataset.slug];
            if (frozenOrder !== undefined) card.style.order = frozenOrder;
          });
        }

        function markCardOpened(card) {
          if (!card || card.dataset.detailDisabled === 'true') return;
          freezeRecentOrder();
          state.lastOpened[card.dataset.slug] = Math.floor(Date.now() / 1000);
          state.deferRecentReorderUntil = Math.max(
            Number(state.deferRecentReorderUntil || 0),
            Date.now() + RECENT_REORDER_DELAY_MS,
          );
          saveLastOpened();
          updateRecentLabel(card);
          restoreFrozenRecentOrder();
        }

    function densityForCount(count) {
      if (count <= 1) return 'feature';
      if (count <= 4) return 'large';
      if (count <= 8) return 'comfort';
      return 'compact';
    }

        function shouldUseSplitFeature(activeCount, inactiveCount) {
          return state.sort === 'manual' && activeCount === 1 && inactiveCount > 0 && window.matchMedia('(min-width: 1080px)').matches;
        }

        function isIconLaunchTarget(target) {
          target = target instanceof Element ? target : target?.parentElement;
          if (!target) return false;
          return Boolean(target.closest('.tool-card .app-mark'));
        }

        function launchCardFromIcon(card) {
          return openLaunchUrlForCard(card);
        }

        function isInteractiveDragTarget(target) {
          target = target instanceof Element ? target : target?.parentElement;
          if (!target) return false;
          if (target.closest('[data-completion-value], [data-pin], .card-menu, .section-divider__button')) return true;
          if (isIconLaunchTarget(target)) return true;
          if (target.closest('[data-open-detail]')) return false;
          return Boolean(target.closest('a, button, input, textarea, select, summary, details, [data-no-card-drag]'));
        }

        function shouldSuppressCardSelection(target) {
          target = target instanceof Element ? target : target?.parentElement;
          if (!target) return false;
          return Boolean(target.closest('.tool-card')) && !isInteractiveDragTarget(target);
        }

        function clearBrowserSelection() {
          const selection = window.getSelection ? window.getSelection() : null;
          if (selection && selection.rangeCount) selection.removeAllRanges();
        }

        function lockCardTextSelection() {
          document.documentElement.classList.add('drag-select-lock');
          document.body.classList.add('drag-select-lock');
          document.documentElement.style.webkitUserSelect = 'none';
          document.body.style.webkitUserSelect = 'none';
          document.documentElement.style.userSelect = 'none';
          document.body.style.userSelect = 'none';
          clearBrowserSelection();
        }

        function unlockCardTextSelection() {
          document.documentElement.classList.remove('drag-select-lock');
          document.body.classList.remove('drag-select-lock');
          document.documentElement.style.webkitUserSelect = '';
          document.body.style.webkitUserSelect = '';
          document.documentElement.style.userSelect = '';
          document.body.style.userSelect = '';
          clearBrowserSelection();
        }

        function cardSelectionLocked() {
          return document.body.classList.contains('drag-select-lock');
        }

        function ensureDropLine() {
          if (dragState.dropLine) return dragState.dropLine;
          const line = document.createElement('div');
          line.className = 'drag-drop-line';
          document.body.appendChild(line);
          dragState.dropLine = line;
          return line;
        }

        function hideDropLine() {
          if (dragState.dropLine) dragState.dropLine.classList.remove('visible');
        }

        function captureDragLayoutRects() {
          dragState.layoutRects = cardList
            .filter(card => card !== dragState.card && !card.classList.contains('hidden') && !card.classList.contains('drag-preview'))
            .map(card => {
              const rect = card.getBoundingClientRect();
              return {
                card,
                activity: activityForCard(card),
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                midX: rect.left + rect.width / 2,
                midY: rect.top + rect.height / 2,
                order: Number(card.style.order || card.dataset.order || 0),
              };
            })
            .sort((a, b) => a.activity.localeCompare(b.activity) || a.order - b.order);
        }

        function dragActivityFromPoint(x, y) {
          if (grid.classList.contains('grid--split-feature')) {
            const rect = grid.getBoundingClientRect();
            return x >= rect.left + rect.width * 0.58 ? 'inactive' : 'active';
          }
          const inactiveVisible = !inactiveDivider.classList.contains('hidden');
          if (!inactiveVisible) return activityForCard(dragState.card);
          const inactiveTop = inactiveDivider.getBoundingClientRect().top;
          return y >= inactiveTop ? 'inactive' : 'active';
        }

        function snapshotsInVisualOrder(activity) {
          return dragState.layoutRects
            .filter(item => item.activity === activity)
            .sort((a, b) => {
              const rowThreshold = Math.min(a.height, b.height) * 0.48;
              if (Math.abs(a.midY - b.midY) > rowThreshold) return a.midY - b.midY;
              return a.midX - b.midX;
            });
        }

        function sameVisualRow(a, b) {
          return Math.abs(a.midY - b.midY) <= Math.min(a.height, b.height) * 0.58;
        }

        function arraysEqual(left, right) {
          return left.length === right.length && left.every((item, index) => item === right[index]);
        }

        function targetDropWouldChange(targetCard, afterTarget) {
          if (!dragState.card || !targetCard || targetCard === dragState.card) return false;
          const dragSlug = dragState.card.dataset.slug;
          const targetSlug = targetCard.dataset.slug;
          const targetActivity = activityForCard(targetCard);
          const targetPinned = state.pins.has(targetSlug);
          const dragPinned = state.pins.has(dragSlug);
          if (targetPinned !== dragPinned) return true;
          const currentGroup = groupForCard(dragState.card);
          const targetGroup = groupFor(targetActivity, dragPinned);
          if (currentGroup !== targetGroup) return true;
          const before = [...normalizeManualOrder(targetGroup)];
          const after = before.filter(slug => slug !== dragSlug);
          const targetIndex = after.indexOf(targetSlug);
          if (targetIndex === -1) return false;
          after.splice(targetIndex + (afterTarget ? 1 : 0), 0, dragSlug);
          return !arraysEqual(before, after);
        }

        function projectedDragRect() {
          const fallback = dragState.card?.getBoundingClientRect();
          const width = dragState.preview ? dragState.preview.offsetWidth : (fallback?.width || 0);
          const height = dragState.preview ? dragState.preview.offsetHeight : (fallback?.height || 0);
          const left = dragState.pointerX - dragState.offsetX;
          const top = dragState.pointerY - dragState.offsetY;
          return {
            left,
            top,
            right: left + width,
            bottom: top + height,
            width,
            height,
            midX: left + width / 2,
            midY: top + height / 2,
          };
        }

        function positionDropLineForSnapshot(snapshot) {
          const line = ensureDropLine();
          line.style.width = `${Math.max(80, snapshot.width)}px`;
          line.style.height = `${Math.max(80, snapshot.height)}px`;
          line.style.transform = `translate3d(${snapshot.left}px, ${snapshot.top}px, 0)`;
          line.classList.add('visible');
        }

        function positionDropLineForZone(activity) {
          const line = ensureDropLine();
          const divider = activity === 'inactive' ? inactiveDivider : activeDivider;
          const rect = divider.getBoundingClientRect();
          const cardRect = dragState.card?.getBoundingClientRect();
          const width = Math.max(120, cardRect?.width || 220);
          const height = Math.max(90, cardRect?.height || 160);
          line.style.width = `${width}px`;
          line.style.height = `${height}px`;
          line.style.transform = `translate3d(${rect.left}px, ${rect.top + rect.height + 12}px, 0)`;
          line.classList.add('visible');
        }

        function clearDragIndicators() {
          document.querySelectorAll('[data-activity-drop]').forEach(zone => zone.classList.remove('is-drop-target'));
          hideDropLine();
        }

        function clearDragTargets() {
          clearDragIndicators();
          cardList.forEach(card => card.classList.remove('is-dragging'));
          document.body.classList.remove('drag-active');
          dragState.noopDrop = false;
          unlockCardTextSelection();
          if (dragState.frame) {
            cancelAnimationFrame(dragState.frame);
            dragState.frame = null;
          }
        }

        function removeFromManualOrders(slug) {
          manualGroups.forEach(group => {
            state.manualOrder[group] = (state.manualOrder[group] || []).filter(item => item !== slug);
          });
        }

        function insertInManualGroup(slug, group, placement, targetSlug, afterTarget) {
          const order = normalizeManualOrder(group).filter(item => item !== slug);
          if (targetSlug) {
            const targetIndex = order.indexOf(targetSlug);
            if (targetIndex !== -1) {
              order.splice(targetIndex + (afterTarget ? 1 : 0), 0, slug);
            } else if (placement === 'start') {
              order.unshift(slug);
            } else {
              order.push(slug);
            }
          } else if (placement === 'start') {
            order.unshift(slug);
          } else {
            order.push(slug);
          }
          state.manualOrder[group] = order;
        }

        function moveCardToActivity(card, activity, placement = 'end') {
          if (!card) return;
          setSortMode('manual');
          const slug = card.dataset.slug;
          const nextActivity = activity === 'inactive' ? 'inactive' : 'active';
          removeFromManualOrders(slug);
          setActivityForCard(card, nextActivity);
          insertInManualGroup(slug, groupFor(nextActivity, state.pins.has(slug)), placement);
          saveManualOrder();
        }

        function toggleActivityCard(card) {
          moveCardToActivity(card, activityForCard(card) === 'active' ? 'inactive' : 'active', 'end');
          applyLayout();
        }

        function togglePinCard(card) {
          if (!card) return;
          const slug = card.dataset.slug;
          const wasPinned = state.pins.has(slug);
          if (wasPinned) {
            state.pins.delete(slug);
          } else {
            state.pins.add(slug);
          }
          const newGroup = groupForCard(card);
          removeFromManualOrders(slug);
          insertInManualGroup(slug, newGroup, wasPinned ? 'start' : 'end');
          savePins();
          saveManualOrder();
          applyLayout();
        }

        function reorderDraggedCard(targetCard, afterTarget) {
          if (!dragState.card || !targetCard || targetCard === dragState.card) return;
          setSortMode('manual');
          const dragSlug = dragState.card.dataset.slug;
          const targetSlug = targetCard.dataset.slug;
          const targetActivity = activityForCard(targetCard);
          const targetPinned = state.pins.has(targetSlug);
          const dragPinned = state.pins.has(dragSlug);
          removeFromManualOrders(dragSlug);
          setActivityForCard(dragState.card, targetActivity);
          if (targetPinned === dragPinned) {
            insertInManualGroup(dragSlug, groupFor(targetActivity, dragPinned), 'end', targetSlug, afterTarget);
          } else {
            insertInManualGroup(dragSlug, groupFor(targetActivity, dragPinned), targetPinned ? 'end' : 'start');
          }
          saveManualOrder();
        }

        function updateDragPreview() {
          dragState.frame = null;
          if (!dragState.preview) return;
          const x = dragState.pointerX - dragState.offsetX;
          const y = dragState.pointerY - dragState.offsetY;
          dragState.preview.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(.35deg)`;
        }

        function scheduleDragPreview() {
          if (!dragState.preview || dragState.frame) return;
          dragState.frame = requestAnimationFrame(updateDragPreview);
        }

        function createDragPreview(card, event) {
          const rect = card.getBoundingClientRect();
          const preview = card.cloneNode(true);
          preview.classList.add('drag-preview');
          preview.classList.remove('is-dragging', 'hidden');
          preview.style.width = `${rect.width}px`;
          preview.style.height = `${rect.height}px`;
          preview.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
          document.body.appendChild(preview);
          dragState.preview = preview;
          dragState.pointerX = event.clientX;
          dragState.pointerY = event.clientY;
          dragState.offsetX = event.clientX - rect.left;
          dragState.offsetY = event.clientY - rect.top;
          captureDragLayoutRects();
          scheduleDragPreview();
        }

        function nearestDropTargetFromDraggedCard() {
          const projected = projectedDragRect();
          const x = projected.midX;
          const y = projected.midY;
          const activity = dragActivityFromPoint(x, y);
          const candidates = dragState.layoutRects.filter(item => item.activity === activity);
          if (!candidates.length) return { card: null, afterTarget: false, activity };
          let best = null;
          let bestScore = Number.POSITIVE_INFINITY;
          candidates.forEach(item => {
            const outsideX = x < item.left ? item.left - x : x > item.right ? x - item.right : 0;
            const outsideY = y < item.top ? item.top - y : y > item.bottom ? y - item.bottom : 0;
            const centerX = Math.abs(x - item.midX) / Math.max(item.width, 1);
            const centerY = Math.abs(y - item.midY) / Math.max(item.height, 1);
            const score = outsideX * outsideX + outsideY * outsideY + centerX * 80 + centerY * 120;
            if (score < bestScore) {
              best = item;
              bestScore = score;
            }
          });
          if (!best) return { card: null, afterTarget: false, activity };
          const nearCenter = Math.abs(x - best.midX) < best.width * 0.16;
          const afterTarget = x > best.midX || (nearCenter && y > best.midY);
          return { card: best.card, snapshot: best, afterTarget, activity };
        }

        function updateDragIndicators(target) {
          clearDragIndicators();
          dragState.target = target.card || null;
          dragState.afterTarget = Boolean(target.afterTarget);
          dragState.dropActivity = target.activity || null;
          dragState.noopDrop = false;
          if (target.card && target.snapshot) {
            const wouldChange = targetDropWouldChange(target.card, Boolean(target.afterTarget));
            dragState.noopDrop = !wouldChange;
            if (wouldChange) {
              positionDropLineForSnapshot(target.snapshot);
            } else {
              hideDropLine();
            }
          } else if (target.activity) {
            positionDropLineForZone(target.activity);
          } else {
            hideDropLine();
          }
        }

        function snapPreviewToCard(preview, card) {
          if (!preview || !card) return;
          const rect = card.getBoundingClientRect();
          preview.classList.add('is-snapping');
          preview.style.width = `${rect.width}px`;
          preview.style.height = `${rect.height}px`;
          preview.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) rotate(0deg)`;
          window.setTimeout(() => {
            preview.remove();
            card.classList.remove('is-dragging');
            document.body.classList.remove('drag-active');
            unlockCardTextSelection();
          }, 230);
        }

        function applyLayout() {
          const visible = [];
          cardList.forEach(card => {
            updateCardDisplayName(card);
            const pinned = state.pins.has(card.dataset.slug);
            const activity = activityForCard(card);
            card.classList.toggle('pinned', pinned && state.sort === 'manual');
            card.classList.toggle('inactive', activity === 'inactive' && state.sort === 'manual');
            const pin = card.querySelector('[data-pin]');
            if (pin) {
              pin.textContent = pinned ? '★' : '☆';
              pin.setAttribute('aria-pressed', String(pinned));
              pin.title = pinned ? 'Pinned in default layout' : 'Pin in default layout';
            }
            const activityButton = card.querySelector('[data-activity-toggle]');
            if (activityButton) {
              activityButton.textContent = activity === 'active' ? 'Move to inactive' : 'Move to active';
            }
            syncCardLaunchLink(card);
            updateCompletionMeter(card);
            updateRecentLabel(card);
            const show = cardVisible(card);
            card.classList.toggle('hidden', !show);
            const modifiedLabel = card.querySelector('[data-role="modified-label"]');
        if (modifiedLabel) modifiedLabel.textContent = formatEpoch(card.dataset.modified || card.dataset.created);
        if (card.dataset.disabled === 'true') {
          const statusLabel = card.querySelector('[data-role="status-label"]');
          if (statusLabel) statusLabel.textContent = 'Planned';
        }
        if (show) visible.push(card);
      });
          const manual = state.sort === 'manual';
          const activeVisible = visible.filter(card => activityForCard(card) === 'active');
          const inactiveVisible = visible.filter(card => activityForCard(card) === 'inactive');
          const splitFeature = shouldUseSplitFeature(activeVisible.length, inactiveVisible.length);
              const density = splitFeature ? 'split-feature' : densityForCount(visible.length);
              grid.classList.remove('grid--compact', 'grid--comfort', 'grid--large', 'grid--feature', 'grid--split-feature');
              grid.classList.add(`grid--${density}`);
              activeDivider.classList.toggle('hidden', !manual || visible.length === 0);
          inactiveDivider.classList.toggle('hidden', true);
          activeDivider.style.order = '0';
          inactiveDivider.style.order = '10000';
          let activeCount = 0;
          let inactiveCount = 0;
          visible.sort(compareCards).forEach((card, index) => {
            card.classList.remove('split-primary');
            card.style.gridColumn = '';
            card.style.gridRow = '';
            if (!manual) {
              card.style.order = String(index);
              return;
            }
            if (activityForCard(card) === 'active') {
              card.style.order = String(10 + activeCount);
              if (splitFeature) {
                card.classList.add('split-primary');
                card.style.gridColumn = '1';
              }
              activeCount += 1;
            } else {
              card.style.order = String(10010 + inactiveCount);
              if (splitFeature) card.style.gridColumn = '2';
              inactiveCount += 1;
            }
          });
          activeDivider.classList.toggle('hidden', !manual || activeCount === 0);
          inactiveDivider.classList.toggle('hidden', !manual || inactiveCount === 0 || splitFeature);
          agencyControls.classList.toggle('visible', state.mode === 'un');
          tagControls?.classList.toggle('visible', true);
      sortControls.classList.toggle('visible', state.mode === 'all');
      if (recentReorderDeferred()) restoreFrozenRecentOrder();
    }

    function render(payload) {
      let ready = 0;
      let running = 0;
      let blocked = 0;
      let external = 0;
      let activeLocalServers = 0;
      let historyChanged = false;
      payload.apps.forEach(app => {
        const card = cards.get(app.slug);
        if (!card) return;
        const serverOpened = Number(app.history?.last_opened_at || 0);
        if (serverOpened && serverOpened > Number(state.lastOpened[app.slug] || 0)) {
          state.lastOpened[app.slug] = serverOpened;
          historyChanged = true;
        }
        if (app.setup) {
          card.dataset.setupReady = String(Boolean(app.setup.ready));
          card.dataset.setupIssues = JSON.stringify(app.setup.issues || []);
        }
        card.dataset.statusDiagnostic = app.diagnostic || '';
        card.dataset.statusSuggestions = JSON.stringify(Array.isArray(app.suggestions) ? app.suggestions : []);
        card.dataset.runtimeUrl = app.runtime_url || app.url || '';
        const dot = card.querySelector('[data-role="dot"]');
        const statusLabel = card.querySelector('[data-role="status-label"]');
        dot.classList.remove('ready', 'running', 'offline', 'blocked', 'external');
        if (!app.static && (app.ready || app.running || app.listening)) {
          activeLocalServers += 1;
        }
        if (app.static) {
          dot.classList.add('external');
          dot.title = 'External link';
          if (statusLabel) statusLabel.textContent = 'External';
          external += 1;
        } else if (app.ready) {
          dot.classList.add('ready');
          dot.title = 'Ready';
          if (statusLabel) statusLabel.textContent = 'Ready';
          ready += 1;
        } else if (app.diagnostic) {
          dot.classList.add('blocked');
          dot.title = app.diagnostic;
          if (statusLabel) statusLabel.textContent = 'Blocked';
          blocked += 1;
        } else if (app.running) {
          dot.classList.add('running');
          dot.title = 'Starting';
          if (statusLabel) statusLabel.textContent = 'Starting';
          running += 1;
        } else {
          dot.classList.add('offline');
          dot.title = 'Stopped';
          if (statusLabel) statusLabel.textContent = 'Stopped';
        }
      });
      if (historyChanged) saveLastOpened();
      if (summary) summary.innerHTML = `<span>${activeLocalServers} active</span>`;
      if (recentReorderDeferred()) {
        updateRecentLabelsOnly();
        restoreFrozenRecentOrder();
      } else {
        state.frozenRecentOrders = null;
        applyLayout();
      }
      if (selectedDetailCard) refreshDetailModal(selectedDetailCard);
    }

        function setDetailControlVisible(element, visible) {
          if (!element) return;
          element.hidden = !visible;
        }

        function parseDetailList(value) {
          try {
            const parsed = JSON.parse(value || '[]');
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
          } catch (error) {
            return [];
          }
        }

        function escapeInlineHtml(value) {
          return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
        }

        function detailFocusableElements() {
          if (!detailModal || detailModal.hidden) return [];
          return [...detailModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(element => {
              if (element.hidden || element.getAttribute('aria-disabled') === 'true') return false;
              const style = window.getComputedStyle(element);
              return style.display !== 'none' && style.visibility !== 'hidden';
            });
        }

        function cardStatusLabel(card) {
          return card.querySelector('[data-role="status-label"]')?.textContent || (card.dataset.disabled === 'true' ? 'Planned' : 'Checking');
        }

        function cardUpdatedLabel(card) {
          return card.querySelector('[data-role="modified-label"]')?.textContent || formatEpoch(card.dataset.modified || card.dataset.created);
        }

        function cardPreviewBackground(card) {
          const shot = card.querySelector('.tool-card__shot');
          if (shot) {
            const style = window.getComputedStyle(shot);
            if (style.backgroundImage && style.backgroundImage !== 'none') return style.backgroundImage;
          }
          const mark = card.querySelector('.app-mark');
          if (mark) {
            const style = window.getComputedStyle(mark);
            const photo = style.getPropertyValue('--card-photo');
            if (photo && photo.trim() && photo.trim() !== 'none') return photo.trim();
          }
          return 'none';
        }

        function initialsForName(name) {
          const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
          if (!parts.length) return 'PS';
          return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
        }

        function detailPhotosForCard(card) {
          let photos = parseDetailList(card.dataset.detailPhotos);
          if (!photos.length) {
            const fallback = cardPreviewBackground(card);
            const match = fallback.match(/^url\(["']?(.*?)["']?\)$/);
            if (match && match[1]) photos = [match[1]];
          }
          return photos;
        }

        function renderDetailLogo(card, name, previewBackground) {
          const iconUrl = card.dataset.detailIconUrl || '';
          detailLogo.style.setProperty('--detail-logo-image', previewBackground || 'none');
          if (iconUrl) {
            detailLogo.innerHTML = `<img src="${escapeInlineHtml(iconUrl)}" alt="" decoding="async">`;
          } else {
            detailLogo.innerHTML = `<span>${escapeInlineHtml(initialsForName(name))}</span>`;
          }
        }

        function closeDetailPhotoViewer() {
          detailPhotoViewer.hidden = true;
          detailPhotoViewerImage.removeAttribute('src');
          detailPhotoViewerLabel.textContent = 'Preview';
        }

        function openDetailPhotoViewer(photos, index, name) {
          const src = photos[index];
          if (!src) return;
          detailPhotoViewerImage.src = src;
          detailPhotoViewerImage.alt = `${name} preview ${index + 1}`;
          detailPhotoViewerLabel.textContent = `Preview ${index + 1} of ${photos.length}`;
          detailPhotoViewer.hidden = false;
          detailPhotoViewerClose.focus();
        }

        function renderDetailPhotos(card, name, sourcePhotos) {
          let photos = [...sourcePhotos];
          if (!photos.length) {
            detailPhotos.innerHTML = `<div class="detail-photo detail-photo--placeholder"><strong>${escapeInlineHtml(name)}</strong><span>Preview pending</span></div>`;
            closeDetailPhotoViewer();
            return;
          }
          const visiblePhotos = photos.slice(0, 4);
          detailPhotos.innerHTML = visiblePhotos.map((photo, index) => `
            <button class="detail-photo detail-photo--${index + 1}" type="button" data-detail-photo-index="${index}" aria-label="View ${escapeInlineHtml(name)} preview ${index + 1}">
              <img src="${escapeInlineHtml(photo)}" alt="" loading="lazy" decoding="async">
            </button>
          `).join('');
          detailPhotos.querySelectorAll('[data-detail-photo-index]').forEach(button => {
            button.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              openDetailPhotoViewer(visiblePhotos, Number(button.dataset.detailPhotoIndex || 0), name);
            });
          });
        }

        function renderDetailChips(card) {
          const tags = parseDetailList(card.dataset.detailTags);
          const tech = parseDetailList(card.dataset.detailTech);
          const chips = [
            ...tags.map(item => [item, 'Tag']),
            ...tech.map(item => [item, 'Tech']),
          ].slice(0, 10);
          detailChipCloud.innerHTML = chips.map(([label, kind]) => `<span title="${escapeInlineHtml(kind)}">${escapeInlineHtml(label)}</span>`).join('');
          detailChipCloud.hidden = chips.length === 0;
        }

        function refreshDetailModal(card) {
          if (!card) return;
          const slug = card.dataset.slug;
          const name = displayNameForCard(card);
          const launchUrl = card.dataset.detailLaunchUrl || '';
          const logsUrl = card.dataset.detailLogsUrl || '';
          const folderUrl = card.dataset.detailFolderUrl || '';
          const stopApi = card.dataset.detailStopApi || '';
          const docUrl = card.dataset.detailDocUrl || '';
          const pdfUrl = card.dataset.detailPdfUrl || '';
          const disabled = card.dataset.detailDisabled === 'true';
          const isStatic = card.dataset.detailStatic === 'true';
          const versionOptions = versionOptionsForCard(card);
          const selectedVersion = selectedVersionForCard(card);

          detailTitleText.textContent = name;
          detailKind.textContent = card.dataset.detailKind || 'Tool';
          detailStatus.textContent = cardStatusLabel(card);
          detailNote.textContent = card.dataset.detailNote || '';
          detailDescription.textContent = card.dataset.detailDescription || card.dataset.detailHeadline || '';
          const statusDiagnostic = card.dataset.statusDiagnostic || '';
          const statusSuggestions = parseDetailList(card.dataset.statusSuggestions);
          if (detailDiagnostic) {
            if (statusDiagnostic) {
              const items = statusSuggestions.length
                ? `<ul>${statusSuggestions.map(item => `<li>${escapeInlineHtml(item)}</li>`).join('')}</ul>`
                : '';
              detailDiagnostic.innerHTML = `<strong>Launch issue</strong><span>${escapeInlineHtml(statusDiagnostic)}</span>${items}`;
              detailDiagnostic.hidden = false;
            } else {
              detailDiagnostic.hidden = true;
              detailDiagnostic.innerHTML = '';
            }
          }
          detailGroup.textContent = card.dataset.detailGroup || card.dataset.groupLabel || '-';
          detailEndpoint.textContent = selectedVersion?.endpoint || card.dataset.detailEndpoint || '-';
          detailCompletion.textContent = `${completionForCard(card)} of 5`;
          detailUpdated.textContent = cardUpdatedLabel(card);
          detailRole.textContent = card.dataset.detailRole || '-';
          detailRename.value = name;
          const previewBackground = cardPreviewBackground(card);
          const photos = detailPhotosForCard(card);
          const nextMediaKey = JSON.stringify({
            slug,
            name,
            icon: card.dataset.detailIconUrl || '',
            previewBackground,
            photos,
          });
          if (nextMediaKey !== detailMediaKey) {
            detailVisual.style.setProperty('--detail-image', previewBackground);
            renderDetailLogo(card, name, previewBackground);
            renderDetailPhotos(card, name, photos);
            closeDetailPhotoViewer();
            detailMediaKey = nextMediaKey;
          }
          renderDetailChips(card);

          if (detailVersion && detailVersionWrap) {
            detailVersion.innerHTML = versionOptions.map(item => `
              <option value="${escapeInlineHtml(item.id)}"${item.id === selectedVersion?.id ? ' selected' : ''}>${escapeInlineHtml(item.label)}</option>
            `).join('');
            detailVersionWrap.hidden = versionOptions.length === 0;
          }

          detailLaunch.href = launchUrlForCard(card);
          detailLaunch.textContent = disabled
            ? 'Launch unavailable'
            : selectedVersion
              ? `↗ View ${selectedVersion.id.toUpperCase()}`
              : '↗ Launch App';
          detailLaunch.setAttribute('aria-disabled', String(disabled || !launchUrl));
          detailLaunch.removeAttribute('target');
          detailLaunch.removeAttribute('rel');
          detailStar.textContent = state.pins.has(slug) ? '★ Starred' : '☆ Star';
          detailActivity.textContent = activityForCard(card) === 'active' ? '↧ Move to inactive' : '↥ Move to active';
          setDetailControlVisible(detailLogs, Boolean(logsUrl));
          detailLogs.href = logsUrl || '#';
          setDetailControlVisible(detailFolder, Boolean(folderUrl));
          detailFolder.href = folderUrl || '#';
          setDetailControlVisible(detailStop, Boolean(stopApi));
          detailStop.dataset.stopApi = stopApi;
          setDetailControlVisible(detailDocs, Boolean(docUrl));
          detailDocs.dataset.docUrl = docUrl;
          setDetailControlVisible(detailDocDownload, Boolean(docUrl));
          detailDocDownload.href = docUrl || '#';
          detailDocDownload.download = `${slug}-readme.md`;
          setDetailControlVisible(detailPdf, Boolean(pdfUrl));
          detailPdf.href = pdfUrl || '#';
        }

        function openDetail(card) {
          if (!card) return;
          detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          selectedDetailCard = card;
          detailMediaKey = '';
          refreshDetailModal(card);
          detailRenameRow.hidden = true;
          docViewer.classList.remove('visible');
          docContent.textContent = '';
          detailModal.hidden = false;
          document.body.classList.add('detail-open');
          window.setTimeout(() => {
            const controls = detailFocusableElements();
            (controls[0] || detailModal).focus();
          }, 0);
        }

        function closeDetail() {
          selectedDetailCard = null;
          detailMediaKey = '';
          detailModal.hidden = true;
          document.body.classList.remove('detail-open');
          docViewer.classList.remove('visible');
          closeDetailPhotoViewer();
          docContent.textContent = '';
          if (detailReturnFocus && typeof detailReturnFocus.focus === 'function') detailReturnFocus.focus();
          detailReturnFocus = null;
        }

        async function loadDetailReadme() {
          const docUrl = detailDocs.dataset.docUrl || '';
          if (!docUrl) return;
          docViewer.classList.add('visible');
          if (/^https?:/i.test(docUrl)) {
            docContent.textContent = 'This documentation is hosted externally. Use the download/open readme action to view it.';
            return;
          }
          docContent.textContent = 'Loading readme...';
          try {
            const response = await fetch(docUrl, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            docContent.textContent = await response.text();
          } catch (error) {
            docContent.textContent = `Could not load readme: ${error && error.message ? error.message : error}`;
          }
        }

        function formatResourceMemory(value) {
          const mb = Number(value || 0);
          if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
          return `${Math.round(mb)} MB`;
        }

        function resourceValue(item, sort) {
          if (sort === 'memory') return Number(item.memory_mb || 0);
          if (sort === 'runtime') return Number(item.runtime_seconds || 0);
          if (sort === 'name') return String(item.name || '').toLowerCase();
          return Number(item.cpu_percent || 0);
        }

        function sortedResourceItems(items) {
          const sort = state.resourceSort || 'cpu';
          const direction = Number(state.resourceSortDirection || -1);
          return [...items].sort((a, b) => {
            const av = resourceValue(a, sort);
            const bv = resourceValue(b, sort);
            if (typeof av === 'string' || typeof bv === 'string') {
              return String(av).localeCompare(String(bv)) * direction;
            }
            return (Number(av) - Number(bv)) * direction;
          });
        }

        function updateResourceSortButtons() {
          document.querySelectorAll('[data-resource-sort]').forEach(button => {
            const active = button.dataset.resourceSort === state.resourceSort;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
            const base = button.dataset.resourceSort === 'memory' ? 'RAM'
              : button.dataset.resourceSort === 'runtime' ? 'Run'
              : button.dataset.resourceSort === 'name' ? 'Name'
              : 'CPU';
            button.textContent = active && state.resourceSortDirection > 0 ? `${base} ↑` : active ? `${base} ↓` : base;
          });
        }

        let resourceCloseTimer = null;
        function clearResourceCloseTimer() {
          if (!resourceCloseTimer) return;
          window.clearTimeout(resourceCloseTimer);
          resourceCloseTimer = null;
        }

        function setResourcePanelOpen(open) {
          if (open) clearResourceCloseTimer();
          if (resourceAdvisorPanel) resourceAdvisorPanel.hidden = !open;
          if (resourceAdvisorToggle) resourceAdvisorToggle.setAttribute('aria-expanded', String(open));
          if (resourceAdvisor) resourceAdvisor.classList.toggle('resource-advisor--open', Boolean(open));
        }

        function scheduleResourcePanelClose() {
          clearResourceCloseTimer();
          resourceCloseTimer = window.setTimeout(() => setResourcePanelOpen(false), 160);
        }

        function resourceStatusText(item) {
          const parts = [`${Number(item.process_count || 0)} proc`];
          if (item.protected) parts.push(item.policy?.label || 'protected');
          parts.push(item.pressure_level || 'low');
          return parts.join(' · ');
        }

        function renderResources(payload) {
          if (!resourceAdvisor || !resourceAdvisorSummary || !resourceAdvisorList) return;
          const summary = payload?.summary || {};
          const items = Array.isArray(payload?.items) ? payload.items : [];
          const running = Number(summary.running || 0);
          resourceAdvisor.hidden = false;
          resourceAdvisorSummary.textContent = `${running} active · ${Number(summary.cpu_percent || 0).toFixed(1)}% CPU · ${formatResourceMemory(summary.memory_mb)}`;
          updateResourceSortButtons();
          const visible = sortedResourceItems(items.filter(item => item.running));
          resourceAdvisorList.innerHTML = visible.map(item => {
            const level = ['low', 'medium', 'high'].includes(item.pressure_level) ? item.pressure_level : 'low';
            const classes = [`resource-item--${level}`];
            if (item.protected) classes.push('resource-item--protected');
            return `
              <tr class="${classes.join(' ')}">
                <td><span class="resource-app-name">${escapeInlineHtml(item.name)}</span><span class="resource-app-meta">${escapeInlineHtml(resourceStatusText(item))}</span></td>
                <td>${Number(item.cpu_percent || 0).toFixed(1)}%</td>
                <td>${formatResourceMemory(item.memory_mb)}</td>
                <td>${escapeInlineHtml(item.runtime_label || '-')}</td>
                <td><button class="resource-stop" type="button" data-resource-stop="${item.stop_api}">Stop</button></td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="5"><p class="resource-advisor__empty">No local app processes are running.</p></td></tr>';
        }


        let resourceRefreshInFlight = null;
        async function refreshResources() {
          if (resourceRefreshInFlight) return resourceRefreshInFlight;
          resourceRefreshInFlight = (async () => {
            if (resourceAdvisorSummary && !resourceAdvisorSummary.textContent.trim()) {
              resourceAdvisorSummary.textContent = 'Loading...';
            }
            const response = await fetch('/api/resources', { cache: 'no-store' });
            if (!response.ok) {
              if (resourceAdvisorSummary) resourceAdvisorSummary.textContent = 'Resource check unavailable';
              return;
            }
            renderResources(await response.json());
          })();
          try {
            return await resourceRefreshInFlight;
          } finally {
            resourceRefreshInFlight = null;
          }
        }

        let refreshInFlight = null;
        async function refresh() {
          if (refreshInFlight) return refreshInFlight;
          refreshInFlight = (async () => {
            const response = await fetch('/api/apps', { cache: 'no-store' });
            if (!response.ok) return;
            render(await response.json());
          })();
          try {
            return await refreshInFlight;
          } finally {
            refreshInFlight = null;
          }
        }

        function startPointerDrag(event, source) {
          if (event.button !== undefined && event.button !== 0) return;
          if (isInteractiveDragTarget(event.target)) return;
          const card = source.closest('.tool-card');
          if (!card) return;
          event.preventDefault();
          lockCardTextSelection();
          dragState.card = card;
          dragState.preview = null;
          dragState.target = null;
          dragState.afterTarget = false;
          dragState.dropActivity = null;
          dragState.noopDrop = false;
          dragState.startX = event.clientX;
          dragState.startY = event.clientY;
          dragState.pointerX = event.clientX;
          dragState.pointerY = event.clientY;
          dragState.moved = false;
          if (source.setPointerCapture && event.pointerId !== undefined) {
            dragState.pointerId = event.pointerId;
            source.setPointerCapture(event.pointerId);
          }
          clearBrowserSelection();
          document.addEventListener('pointermove', handlePointerDragMove);
          document.addEventListener('pointerup', finishPointerDrag);
          document.addEventListener('pointercancel', cancelPointerDrag);
        }

        function handlePointerDragMove(event) {
          if (!dragState.card) return;
          const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
          if (distance > 5 && !dragState.moved) {
            dragState.moved = true;
            setSortMode('manual');
            dragState.card.classList.add('is-dragging');
            document.body.classList.add('drag-active');
            createDragPreview(dragState.card, { clientX: dragState.startX, clientY: dragState.startY });
          }
          if (!dragState.moved) return;
          event.preventDefault();
          dragState.pointerX = event.clientX;
          dragState.pointerY = event.clientY;
          scheduleDragPreview();
          updateDragIndicators(nearestDropTargetFromDraggedCard());
        }

        function detachPointerDragListeners() {
          document.removeEventListener('pointermove', handlePointerDragMove);
          document.removeEventListener('pointerup', finishPointerDrag);
          document.removeEventListener('pointercancel', cancelPointerDrag);
        }

        function cancelPointerDrag() {
          const preview = dragState.preview;
          detachPointerDragListeners();
          if (preview) preview.remove();
          dragState.card = null;
          dragState.preview = null;
          dragState.target = null;
          dragState.dropActivity = null;
          dragState.noopDrop = false;
          dragState.layoutRects = [];
          clearDragTargets();
        }

        function finishPointerDrag(event) {
          if (!dragState.card) return;
          if (!dragState.moved) {
            cancelPointerDrag();
            return;
          }
          event.preventDefault();
          detachPointerDragListeners();
          unlockCardTextSelection();
          const card = dragState.card;
          const preview = dragState.preview;
          const target = dragState.target;
          const afterTarget = dragState.afterTarget;
          const dropActivity = dragState.dropActivity;
          const noopDrop = dragState.noopDrop;
          const projected = projectedDragRect();
          clearDragIndicators();
          card.dataset.suppressClick = 'true';
          window.setTimeout(() => delete card.dataset.suppressClick, 0);
          if (noopDrop) {
            // Same-slot drops should snap back without mutating order or showing a destination.
          } else if (target) {
            reorderDraggedCard(target, afterTarget);
          } else if (dropActivity) {
            moveCardToActivity(card, dropActivity, 'start');
          } else {
            const inactiveVisible = !inactiveDivider.classList.contains('hidden');
            if (grid.classList.contains('grid--split-feature')) {
              const rect = grid.getBoundingClientRect();
              moveCardToActivity(card, projected.midX >= rect.left + rect.width * 0.58 ? 'inactive' : 'active', 'end');
              dragState.card = null;
              dragState.preview = null;
              dragState.target = null;
              dragState.dropActivity = null;
              dragState.noopDrop = false;
              dragState.layoutRects = [];
              if (dragState.frame) {
                cancelAnimationFrame(dragState.frame);
                dragState.frame = null;
              }
              applyLayout();
              snapPreviewToCard(preview, card);
              return;
            }
            const inactiveTop = inactiveVisible ? inactiveDivider.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
            moveCardToActivity(card, projected.midY >= inactiveTop ? 'inactive' : 'active', 'end');
          }
          dragState.card = null;
          dragState.preview = null;
          dragState.target = null;
          dragState.dropActivity = null;
          dragState.noopDrop = false;
          dragState.layoutRects = [];
          if (dragState.frame) {
            cancelAnimationFrame(dragState.frame);
            dragState.frame = null;
          }
          applyLayout();
          snapPreviewToCard(preview, card);
        }

        function syncStudioSelectors() {
          document.querySelectorAll('[data-mode]').forEach(item => {
            const active = item.dataset.mode === state.mode;
            item.classList.toggle('active', active);
            item.setAttribute('aria-selected', String(active));
          });
          document.querySelectorAll('[data-agency]').forEach(item => {
            const active = item.dataset.agency === state.agency;
            item.classList.toggle('active', active);
            item.setAttribute('aria-selected', String(active));
          });
          document.querySelectorAll('[data-tag]').forEach(item => {
            const active = item.dataset.tag === state.tag;
            item.classList.toggle('active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          if (studioSearch && studioSearch.value !== state.query) studioSearch.value = state.query;
        }

        document.getElementById('refresh')?.addEventListener('click', () => refresh().catch(() => {}));
        studioSearch?.addEventListener('input', event => {
          state.query = event.target.value || '';
          applyLayout();
        });
        studioSearch?.addEventListener('keydown', event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          state.query = '';
          studioSearch.value = '';
          applyLayout();
        });
        document.addEventListener('click', event => {
          const modeButton = event.target.closest('[data-mode]');
          if (modeButton) {
            event.preventDefault();
            state.mode = modeButton.dataset.mode || 'all';
            if (state.mode !== 'un') state.agency = 'all';
            syncStudioSelectors();
            applyLayout();
            return;
          }

          const agencyButton = event.target.closest('[data-agency]');
          if (agencyButton) {
            event.preventDefault();
            state.agency = agencyButton.dataset.agency || 'all';
            syncStudioSelectors();
            applyLayout();
            return;
          }

          const tagButton = event.target.closest('[data-tag]');
          if (tagButton) {
            event.preventDefault();
            state.tag = tagButton.dataset.tag || 'all';
            syncStudioSelectors();
            applyLayout();
            return;
          }

          const sortButton = event.target.closest('[data-sort]');
          if (sortButton) {
            event.preventDefault();
            setSortMode(sortButton.dataset.sort || 'manual');
            applyLayout();
          }
        });
        function closeCardMenus(exceptMenu = null) {
          document.querySelectorAll('.card-menu[open]').forEach(menu => {
            if (menu !== exceptMenu) {
              menu.removeAttribute('open');
              menu.querySelector('summary')?.setAttribute('aria-expanded', 'false');
            }
          });
        }

        function setCardMenuOpen(menu, open) {
          if (!menu) return;
          const summary = menu.querySelector('summary');
          if (open) {
            closeCardMenus(menu);
            menu.setAttribute('open', '');
          } else {
            menu.removeAttribute('open');
          }
          summary?.setAttribute('aria-expanded', String(Boolean(open)));
        }

        document.querySelectorAll('.card-menu > summary').forEach(summary => {
          summary.setAttribute('aria-haspopup', 'menu');
          summary.setAttribute('aria-expanded', 'false');
          summary.addEventListener('pointerdown', event => {
            event.stopPropagation();
          });
          summary.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const menu = summary.closest('.card-menu');
            setCardMenuOpen(menu, !menu?.hasAttribute('open'));
          });
          summary.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            const menu = summary.closest('.card-menu');
            setCardMenuOpen(menu, !menu?.hasAttribute('open'));
          });
        });

        document.querySelectorAll('[data-launch-control]').forEach(link => {
          link.addEventListener('click', event => {
            const card = link.closest('.tool-card');
            if (!card) return;
            event.preventDefault();
            openLaunchUrlForCard(card);
          });
        });
        detailLaunch.addEventListener('click', event => {
          if (!selectedDetailCard) return;
          event.preventDefault();
          openLaunchUrlForCard(selectedDetailCard);
        });
        detailVersion?.addEventListener('change', event => {
          if (!selectedDetailCard) return;
          state.versions[selectedDetailCard.dataset.slug] = event.target.value;
          saveSelectedVersions();
          syncCardLaunchLink(selectedDetailCard);
          refreshDetailModal(selectedDetailCard);
        });
        document.querySelectorAll('[data-completion-value]').forEach(button => {
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const card = button.closest('.tool-card');
            if (!card) return;
            setCompletionForCard(card, button.dataset.completionValue);
          });
        });
        document.querySelectorAll('[data-open-detail]').forEach(surface => {
          surface.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const card = surface.closest('.tool-card');
            if (!card || card.dataset.suppressClick === 'true') return;
            openDetail(card);
          });
          surface.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            const card = surface.closest('.tool-card');
            if (card) openDetail(card);
          });
        });
        document.querySelectorAll('[data-open-detail-menu]').forEach(button => {
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const card = button.closest('.tool-card');
            closeCardMenus();
            if (card) openDetail(card);
          });
        });
        document.querySelectorAll('[data-close-detail]').forEach(control => {
          control.addEventListener('click', closeDetail);
        });
        document.addEventListener('keydown', event => {
          if (detailModal.hidden) return;
          if (event.key === 'Escape') {
            if (!detailPhotoViewer.hidden) {
              closeDetailPhotoViewer();
              return;
            }
            closeDetail();
            return;
          }
          if (event.key !== 'Tab') return;
          const controls = detailFocusableElements();
          if (!controls.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        });
        detailStar.addEventListener('click', () => {
          if (!selectedDetailCard) return;
          togglePinCard(selectedDetailCard);
          refreshDetailModal(selectedDetailCard);
        });
        detailActivity.addEventListener('click', () => {
          if (!selectedDetailCard) return;
          toggleActivityCard(selectedDetailCard);
          refreshDetailModal(selectedDetailCard);
        });
        detailDocs.addEventListener('click', () => loadDetailReadme());
        docClose.addEventListener('click', () => docViewer.classList.remove('visible'));
        detailPhotoViewerClose.addEventListener('click', closeDetailPhotoViewer);
        detailRenameToggle.addEventListener('click', () => {
          if (!selectedDetailCard) return;
          detailRenameRow.hidden = false;
          detailRename.value = displayNameForCard(selectedDetailCard);
          detailRename.focus();
          detailRename.select();
        });
        detailRenameCancel.addEventListener('click', () => {
          detailRenameRow.hidden = true;
          if (selectedDetailCard) detailRename.value = displayNameForCard(selectedDetailCard);
        });
        detailRenameSave.addEventListener('click', () => {
          if (!selectedDetailCard) return;
          const name = detailRename.value.trim();
          if (name) {
            state.names[selectedDetailCard.dataset.slug] = name;
          } else {
            delete state.names[selectedDetailCard.dataset.slug];
          }
          saveRenames();
          applyLayout();
          detailRenameRow.hidden = true;
          refreshDetailModal(selectedDetailCard);
        });
        detailStop.addEventListener('click', async () => {
          const stopApi = detailStop.dataset.stopApi || '';
          if (!stopApi) return;
          detailStop.textContent = 'Stopping...';
          try {
            await fetch(stopApi, { method: 'POST', cache: 'no-store' });
            await refresh();
          } catch (error) {
            console.warn('Stop failed', error);
          } finally {
            detailStop.textContent = '■ Stop';
            if (selectedDetailCard) refreshDetailModal(selectedDetailCard);
          }
        });
        function suppressCardTextSelectionEvent(event) {
          if (!cardSelectionLocked() && !shouldSuppressCardSelection(event.target)) return;
          event.preventDefault();
          clearBrowserSelection();
        }

        document.addEventListener('pointerdown', event => {
          if (!shouldSuppressCardSelection(event.target)) return;
          lockCardTextSelection();
          event.preventDefault();
        }, { capture: true });
        document.addEventListener('mousedown', suppressCardTextSelectionEvent, true);
        document.addEventListener('selectstart', suppressCardTextSelectionEvent, true);
        document.addEventListener('dragstart', suppressCardTextSelectionEvent, true);
        document.addEventListener('pointermove', event => {
          if (!cardSelectionLocked()) return;
          event.preventDefault();
          clearBrowserSelection();
        }, { capture: true, passive: false });
        document.addEventListener('mousemove', event => {
          if (!cardSelectionLocked()) return;
          event.preventDefault();
          clearBrowserSelection();
        }, { capture: true, passive: false });
        document.addEventListener('selectionchange', () => {
          if (cardSelectionLocked()) clearBrowserSelection();
        });

        cardList.forEach(card => {
          card.addEventListener('pointerdown', event => startPointerDrag(event, card));
          const mark = card.querySelector('.app-mark');
          if (mark && card.dataset.detailDisabled !== 'true') {
            mark.setAttribute('role', 'button');
            mark.setAttribute('tabindex', '0');
            mark.setAttribute('aria-label', `Launch ${displayNameForCard(card)}`);
            mark.addEventListener('keydown', event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              launchCardFromIcon(card);
            });
          }
          card.addEventListener('click', event => {
            if (card.dataset.suppressClick === 'true') {
              event.preventDefault();
              event.stopPropagation();
              delete card.dataset.suppressClick;
              return;
            }
            if (event.defaultPrevented) {
              return;
            }
            if (isIconLaunchTarget(event.target)) {
              event.preventDefault();
              event.stopPropagation();
              if (!launchCardFromIcon(card)) openDetail(card);
              return;
            }
            if (isInteractiveDragTarget(event.target)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            openDetail(card);
          }, true);
        });
    document.querySelectorAll('[data-pin]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
            const card = button.closest('.tool-card');
            if (!card) return;
            togglePinCard(card);
          });
        });
        document.querySelectorAll('[data-activity-toggle]').forEach(button => {
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const card = button.closest('.tool-card');
            if (!card) return;
            toggleActivityCard(card);
            closeCardMenus();
          });
        });
    document.addEventListener('click', event => {
      document.querySelectorAll('.card-menu[open]').forEach(menu => {
        if (!menu.contains(event.target)) setCardMenuOpen(menu, false);
      });
        });
    resourceAdvisorToggle?.addEventListener('click', event => {
      event.stopPropagation();
      setResourcePanelOpen(true);
    });
    resourceAdvisor?.addEventListener('pointerenter', () => setResourcePanelOpen(true));
    resourceAdvisor?.addEventListener('pointerleave', scheduleResourcePanelClose);
    resourceAdvisor?.addEventListener('focusin', () => setResourcePanelOpen(true));
    resourceAdvisor?.addEventListener('keydown', event => {
      if (event.key === 'Escape') setResourcePanelOpen(false);
    });
    document.addEventListener('click', event => {
      if (!resourceAdvisor || !resourceAdvisorPanel || resourceAdvisorPanel.hidden) return;
      if (resourceAdvisor.contains(event.target)) return;
      setResourcePanelOpen(false);
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-resource-sort]');
      if (!button) return;
      event.preventDefault();
      const nextSort = button.dataset.resourceSort || 'cpu';
      if (state.resourceSort === nextSort) {
        state.resourceSortDirection *= -1;
      } else {
        state.resourceSort = nextSort;
        state.resourceSortDirection = nextSort === 'name' ? 1 : -1;
      }
      updateResourceSortButtons();
      refreshResources().catch(() => {});
    });
    resourceAdvisorList?.addEventListener('click', async event => {
      const button = event.target.closest('[data-resource-stop]');
      if (!button) return;
      event.preventDefault();
      button.disabled = true;
      button.textContent = 'Stopping';
      try {
        await fetch(button.dataset.resourceStop, { method: 'POST', cache: 'no-store' });
        await Promise.all([refresh(), refreshResources()]);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Stop';
      }
    });
    const refreshDelay = () => (document.hidden ? 60000 : 15000);
    const resourceDelay = () => (document.hidden ? 180000 : 45000);
    let refreshTimer = null;
    let resourceTimer = null;
    function scheduleStatusRefresh(delay = refreshDelay()) {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        try {
          await refresh();
        } catch (error) {
          // Status refresh is opportunistic; individual launch actions surface errors.
        } finally {
          scheduleStatusRefresh();
        }
      }, delay);
    }
    function scheduleResourceRefresh(delay = resourceDelay()) {
      if (resourceTimer) window.clearTimeout(resourceTimer);
      resourceTimer = window.setTimeout(async () => {
        try {
          await refreshResources();
        } catch (error) {
          // Resource refresh is advisory only.
        } finally {
          scheduleResourceRefresh();
        }
      }, delay);
    }
    document.addEventListener('visibilitychange', () => {
      scheduleStatusRefresh(document.hidden ? refreshDelay() : 250);
      scheduleResourceRefresh(document.hidden ? resourceDelay() : 750);
    });
    render(window.__INITIAL_APPS__);
    scheduleStatusRefresh(120);
    scheduleResourceRefresh(100);

// Native dialog supplies focus containment, Escape close and focus restoration.
(() => {
  const dialog = document.getElementById('addProjectDialog');
  const form = document.getElementById('addProjectForm');
  document.getElementById('addProjectButton')?.addEventListener('click', () => dialog.showModal());
  document.getElementById('cancelAddProject')?.addEventListener('click', () => dialog.close());
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(form);
    const command = String(values.get('command') || '').trim();
    const project = {name: values.get('name'), slug: values.get('slug'), url: values.get('url'), category: String(values.get('category') || '').trim(), processes: []};
    if (command) project.processes.push({name:'app', repo:values.get('repo'), command, ports:values.get('port') ? [Number(values.get('port'))] : []});
    const message = document.getElementById('addProjectMessage');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch('/api/projects/register', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({project, trust_commands:values.get('trust') === 'on'})});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Registration failed');
      location.reload();
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
})();

(() => {
  const dialog = document.getElementById('categoriesDialog');
  const form = document.getElementById('categoriesForm');
  document.getElementById('editCategoriesButton')?.addEventListener('click', () => dialog.showModal());
  document.getElementById('cancelCategories')?.addEventListener('click', () => dialog.close());
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const assignments = Object.fromEntries([...form.querySelectorAll('[data-category-project]')]
      .filter(input => input.value.trim() !== input.defaultValue.trim())
      .map(input => [input.dataset.categoryProject, input.value.trim()]));
    try {
      const response = await fetch('/api/projects/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(assignments)});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Unable to save categories');
      location.reload();
    } catch (error) { document.getElementById('categoriesMessage').textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
