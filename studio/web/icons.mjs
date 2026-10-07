// Shared decorative line icons. Labels stay in the surrounding HTML.
const paths={
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
 gallery:'<rect x="7" y="3" width="14" height="15" rx="2"/><path d="M17 21H5a2 2 0 0 1-2-2V7m4 6 4-4 4 4 2-2 4 4"/>',
 inbox:'<path d="m4 4-2 10v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5L20 4Z"/><path d="M2 14h6l2 3h4l2-3h6"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
 arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
 external:'<path d="M7 17 17 7M7 7h10v10"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 menu:'<path d="M4 8h16M4 16h16"/>',
 logout:'<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4m7-14 5 5-5 5M9 12h12"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 check:'<path d="m5 12 4 4L19 6"/>'
};
export const icon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]||paths.image}</svg>`;
