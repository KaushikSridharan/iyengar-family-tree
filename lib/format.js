const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const UI_STRINGS = {
  appDefaultTitle: 'Family Tree',
  home: 'Home',
  back: 'Back',
  searchPlaceholder: 'Search by name…',
  searchEmpty: 'No relatives match that name.',
  details: 'Details',
  close: 'Close',
  viewFamily: 'View family',
  howConnected: 'How connected?',
  thisIsMe: 'This is me',
  notMe: 'Not me',
  parents: 'Parents',
  mother: 'Mother',
  father: 'Father',
  parent: 'Parent',
  grandparents: 'Grandparents',
  greatGrandparents: 'Great-grandparents',
  siblings: 'Siblings',
  children: 'Children',
  grandchildren: 'Grandchildren',
  greatGrandchildren: 'Great-grandchildren',
  focus: 'focus',
  focusAndSpouse: 'focus & spouse',
  focusAndSpouseTitle: 'Focus & spouse',
  nextSpouse: 'Show next spouse',
  scrollLeft: 'Scroll left',
  scrollRight: 'Scroll right',
  unknownParents: 'Parents not recorded',
  noChildren: 'No recorded children',
  bornLabel: 'Born',
  diedLabel: 'Died',
  birthplaceLabel: 'Birthplace',
  currentlyStayingLabel: 'Currently staying',
  lastLivedLabel: 'Lived in',
  notesLabel: 'Notes',
  spouseParentsHint: 'Has parents',
  connectionTitle: 'How we are connected',
  connectionFromLabel: 'From',
  connectionToLabel: 'To',
  connectionNone: 'No known connection yet',
  connectionNoneDetail: 'These two people belong to branches that are not linked in the tree data yet.',
  connectionSamePerson: 'This is the same person.',
  connectionShowMore: 'Show more paths',
  connectionMarriageMarker: 'via marriage',
  pathLabel: 'Path',
  offlineBanner: 'Offline — showing cached family tree',
  updateNotice: 'Tree updated, tap to refresh',
  refreshNow: 'Refresh',
  installApp: 'Install app',
  installHintAndroid: 'Install this tree on your phone for quick offline access.',
  installHowToIOS: 'Tap Share, then "Add to Home Screen".',
  dismiss: 'Dismiss',
  lastUpdatedPrefix: 'Updated',
  overviewTitle: 'Tree overview',
  overviewButton: 'Overview',
  keyboardHelp: 'Arrow keys navigate · / searches · Backspace goes back',
  pickParentPrompt: 'Choose parent',
  pickChildPrompt: 'Choose child',
  pickRelativePrompt: 'Choose relative',
  loadErrorTitle: 'Unable to load the family tree',
  loadErrorRetry: 'Try again',
  unknownPersonPrefix: 'Could not find person',
  unknownPersonFallback: 'Showing the starting person instead.',
  kinshipLanguageLabel: 'Relationship labels',
  kinshipEnglish: 'English',
  kinshipMarathi: 'Marathi & English',
};

export function extractYear(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = /^(\d{4})/.exec(dateStr.trim());
  return m ? m[1] : '';
}

export function formatYearsShort(person) {
  const birthYear = extractYear(person.born);
  const deathYear = extractYear(person.died);
  if (deathYear) {
    return birthYear ? `${birthYear}–${deathYear}` : `d. ${deathYear}`;
  }
  return birthYear ? `b. ${birthYear}` : '';
}

export function formatDateForDetails(dateStr) {
  if (!dateStr) return '';
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(dateStr.trim());
  if (!m) return dateStr;
  const [, year, monthStr, dayStr] = m;
  if (monthStr && dayStr) {
    const idx = Number(monthStr) - 1;
    const day = Number(dayStr);
    if (idx >= 0 && idx < 12) return `${day} ${MONTHS[idx]} ${year}`;
  }
  if (monthStr) {
    const idx = Number(monthStr) - 1;
    if (idx >= 0 && idx < 12) return `${MONTHS[idx]} ${year}`;
  }
  return year;
}

export function parentRoleLabel(person) {
  if (person?.gender === 'f') return UI_STRINGS.mother;
  if (person?.gender === 'm') return UI_STRINGS.father;
  return UI_STRINGS.parent;
}

export function normalizeSearchText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function getPhotoUrls(photo) {
  if (!photo) return {};
  if (/^https?:\/\//i.test(photo)) {
    return { thumb: photo, detail: photo };
  }
  const thumb = photo.replace(/\.webp$/i, '.thumb.webp');
  return {
    thumb: `./photos/${thumb}`,
    detail: `./photos/${photo}`,
  };
}

const AVATAR_TONES = [
  { bg: '#EAE3D6', text: '#4A3F32' },
  { bg: '#E1EAE4', text: '#244638' },
  { bg: '#E3E7EC', text: '#2F4156' },
  { bg: '#EDE2DF', text: '#5D352E' },
  { bg: '#E6E4EC', text: '#413B57' },
];

export function getAvatarTone(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
