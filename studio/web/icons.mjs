// Shared decorative line icons. Labels stay in the surrounding HTML.
const paths={
 heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
 bookmark:'<path d="M6 3.75A1.75 1.75 0 0 1 7.75 2h8.5A1.75 1.75 0 0 1 18 3.75V22l-6-3.75L6 22V3.75Z"/>',
 download:'<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19.5v1.25A1.25 1.25 0 0 0 5.25 22h13.5A1.25 1.25 0 0 0 20 20.75V19.5"/>',

 phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
 facebook:'<path d="M14 22v-9h3l.5-4H14V6.5c0-1.2.3-2 2-2H18V1.2A24 24 0 0 0 15.1 1C12.2 1 10 2.8 10 6v3H7v4h3v9"/>',
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
