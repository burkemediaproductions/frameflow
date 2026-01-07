const BASE = "https://younqiue-yoga.onrender.com/api/gizmos/fitdegree/public";

function esc(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function fmt(iso){
  if(!iso) return "";
  const d=new Date(iso);
  return d.toLocaleString([], { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
}

export async function renderFeaturedClasses(containerId, { days=7, limit=6 } = {}) {
  const el=document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = `<div class="card">Loading classes…</div>`;
  try{
    const res=await fetch(`${BASE}/featured-classes?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`);
    const data=await res.json();
    if(!Array.isArray(data)) throw new Error(data?.error || "Unexpected response");
    el.innerHTML = data.map(c=>`
      <article class="card">
        <h3>${esc(c.name)}</h3>
        <p>${esc(fmt(c.start_at))}</p>
        <div class="tagrow">
          ${c.instructor?`<span class="tag">${esc(c.instructor)}</span>`:""}
          ${typeof c.spots_remaining==="number" && !Number.isNaN(c.spots_remaining)?`<span class="tag">${c.spots_remaining} spots</span>`:""}
        </div>
      </article>
    `).join("") || `<div class="card"><h3>No classes found</h3><p>Check back soon.</p></div>`;
  }catch(e){
    el.innerHTML = `<div class="card"><h3>Couldn’t load classes</h3><p>${esc(e?.message||"Try again later.")}</p></div>`;
  }
}

export async function renderInstructors(containerId) {
  const el=document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = `<div class="card">Loading instructors…</div>`;
  try{
    const res=await fetch(`${BASE}/instructors`);
    const data=await res.json();
    if(!Array.isArray(data)) throw new Error(data?.error || "Unexpected response");
    el.innerHTML = data.map(p=>`
      <article class="card">
        <div style="display:flex; gap:12px; align-items:center;">
          <div style="width:54px; height:54px; border-radius:14px; overflow:hidden; background: rgba(255,255,255,0.08); flex:0 0 54px;">
            ${p.photo_url?`<img src="${esc(p.photo_url)}" alt="${esc(p.name)}" style="width:100%; height:100%; object-fit:cover;" />`:""}
          </div>
          <div>
            <h3 style="margin:0;">${esc(p.name)}</h3>
            ${Array.isArray(p.specialties)&&p.specialties.length?`<p style="margin:6px 0 0; opacity:.85;">${esc(p.specialties.slice(0,3).join(" • "))}</p>`:""}
          </div>
        </div>
        ${p.bio?`<p style="margin-top:12px; opacity:.92;">${esc(p.bio)}</p>`:""}
      </article>
    `).join("") || `<div class="card"><h3>No instructors found</h3><p>Check back soon.</p></div>`;
  }catch(e){
    el.innerHTML = `<div class="card"><h3>Couldn’t load instructors</h3><p>${esc(e?.message||"Try again later.")}</p></div>`;
  }
}
