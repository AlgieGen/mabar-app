import { escapeHtml } from './util.js';

export function initPlanning(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  const notes = $('notes');
  let notesTimer;

  function renderTasks(tasks) {
    $('taskEmpty').classList.toggle('hidden', tasks.length > 0);
    $('taskList').innerHTML = tasks.map((t) => {
      const meta = [
        t.date && `📅 ${new Date(t.date + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        t.assignee && `👤 ${escapeHtml(t.assignee)}`,
        `oleh ${escapeHtml(t.by)}`,
      ].filter(Boolean).join(' · ');
      return `
        <li class="${t.done ? 'done' : ''}" data-id="${t.id}">
          <input type="checkbox" ${t.done ? 'checked' : ''} />
          <div class="t-body">
            <div class="t-text">${escapeHtml(t.text)}</div>
            <div class="t-meta">${meta}</div>
          </div>
          <button class="t-del" title="Hapus">✕</button>
        </li>`;
    }).join('');
  }

  $('taskList').addEventListener('click', (e) => {
    const id = e.target.closest('li')?.dataset.id;
    if (!id) return;
    if (e.target.matches('input[type="checkbox"]')) socket.emit('plan:toggle', id);
    if (e.target.matches('.t-del')) socket.emit('plan:delete', id);
  });

  $('taskForm').onsubmit = (e) => {
    e.preventDefault();
    socket.emit('plan:add', { text: $('taskText').value, date: $('taskDate').value, assignee: $('taskAssignee').value });
    $('taskText').value = '';
    $('taskDate').value = '';
  };

  // Pilihan "ditugaskan ke" mengikuti daftar anggota
  ctx.memberListeners.push((members) => {
    const sel = $('taskAssignee');
    const current = sel.value;
    sel.innerHTML = '<option value="">Siapa saja</option>' +
      members.map((m) => `<option>${escapeHtml(m.name)}</option>`).join('');
    sel.value = current;
  });

  notes.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => socket.emit('plan:notes', notes.value), 250);
  });

  function setNotes(text) {
    if (notes.value === text) return;
    const { selectionStart, selectionEnd } = notes;
    notes.value = text;
    if (document.activeElement === notes) notes.setSelectionRange(selectionStart, selectionEnd);
  }

  socket.on('plan:tasks', renderTasks);
  socket.on('plan:notes', setNotes);

  return {
    load(plan) {
      renderTasks(plan.tasks);
      setNotes(plan.notes);
    },
  };
}
