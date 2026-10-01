// Home → ▾: Labels (every label in this browser) and Backup & sync (export, import), as in safe.wei.
import { h, put, sheet, short, copy, icon, ICONS, iconButton, labelDialog, warn, bad, toClipboard } from './ui.js';
import * as labels from './labels.js';
import * as backup from './backup.js';
import { load, store } from './store.js';

/** Every label, one line each, newest first or by name; add, edit, remove (with Undo). */
export function labelsSheet() {
  const { body } = sheet('tag', 'Labels', true), el = h('div.labels');
  let by = load('labelsort', 'date') === 'name' ? 'name' : 'date';
  const draw = () => {
    const at = labels.dates();
    const l = Object.entries(labels.all()).sort(by === 'name' ? (a, b) => a[1].localeCompare(b[1]) : (a, b) => (at[b[0]] || 0) - (at[a[0]] || 0) || a[1].localeCompare(b[1]));
    const sort = h('select.lsort', { 'aria-label': 'Sort labels', onchange: () => (store('labelsort', (by = sort.value)), draw()) }, h('option', { value: 'date' }, 'Newest first'), h('option', { value: 'name' }, 'Name (A–Z)'));
    sort.value = by;
    put(el,
      h('p.mut.small', 'Your names for addresses, shown instead of the address everywhere in roles.wei. Kept in this browser.'),
      h('div.lhead', l.length > 1 && sort, h('span.grow'), h('button.sm', { onclick: () => labelDialog() }, '+ Add label')),
      l.length ? h('div.slist.llist', l.map(([a, name]) => {
        const c = copy(a, 'Copy address');
        return h('div.srow.lrow', h('b.lname', { title: name }, name), h('code.sa', { title: a }, short(a)), c, h('span.grow'),
          iconButton('edit', 'Edit label', () => labelDialog(a)),
          iconButton('close', 'Remove label', () => {
            const when = at[a];
            labels.set(a, '');
            const undo = h('p.small', 'Removed ' + name + '. ', h('button.link', { onclick: () => labels.set(a, name, when) }, 'Undo'));
            setTimeout(() => undo.remove(), 6000);
            el.append(undo);
          }));
      })) : h('p.empty', 'Name any address with its tag icon, or add one here.'));
  };
  addEventListener('labels', () => el.isConnected && draw());
  draw();
  body.append(el);
}

const words = (c) => [c.saved + ' address' + (c.saved === 1 ? '' : 'es'), c.labels + ' label' + (c.labels === 1 ? '' : 's'), c.abis + ' ABI' + (c.abis === 1 ? '' : 's')].join(' · ');

/** Export as a link or JSON, or import one (roles.wei or safe.wei), with a preview before anything changes. */
export function backupDialog(incoming, done) {
  const { body: d, close, setTitle } = sheet('gear', 'Backup & sync', true);
  const exportView = () => {
    const data = backup.collect(), out = h('div'), inErr = h('div');
    const btn = (text, fn, cls = '') => { const b = h('button' + cls, text); b.onclick = () => fn().then(() => (put(b, '✓ Copied'), setTimeout(() => put(b, text), 1500)), (e) => put(out, bad(e.message))); return b; };
    const ta = h('textarea', { placeholder: 'Paste a roles.wei or safe.wei backup link or JSON', spellcheck: 'false', rows: 3 });
    const next = async () => { try { preview(await backup.parse(ta.value)); } catch (e) { put(inErr, bad(/JSON|Unexpected/.test(e.message) ? 'That does not look like a backup.' : e.message)); } };
    setTitle('Backup & sync');
    put(d,
      h('p.mut.small', 'Move your saved addresses, labels and contract ABIs to another device. Nothing is uploaded: it all travels in the link or JSON. Your RPC endpoints and Etherscan key are not included.'),
      h('div.bsec', h('b', 'Export'), h('div.mut.small', words(backup.counts(data)))),
      h('div.actions', btn('Copy link', async () => toClipboard(await backup.link(data)), '.primary'), btn('Copy JSON', async () => toClipboard(JSON.stringify(data, null, 2)))),
      h('p.mut.small', 'Open the link on your other device, or import the JSON there.'), out,
      h('div.bsec', h('b', 'Import'), h('div.mut.small', 'A roles.wei backup, or a safe.wei one (its Safes, labels and ABIs).')),
      ta, h('div.actions', h('span.grow'), h('button.primary', { onclick: next }, 'Continue')), inErr);
  };
  const preview = (data) => {
    const c = backup.counts(data), mine = labels.all(), ls = Object.entries(data.labels);
    let mode = 'merge';
    const opt = (v, title, desc) => h('label.opt', h('input', { type: 'radio', name: 'mode', value: v, checked: v === 'merge', onchange: () => (mode = v) }), h('span', h('b', title), h('span.mut.small', desc)));
    setTitle('Import backup');
    put(d,
      h('p', words(c), data.from === 'safe.wei' && h('span.mut', ' · from safe.wei'), data.at && h('span.mut', ' · exported ' + new Date(data.at).toLocaleDateString())),
      ls.length > 0 && [warn('Labels are shown instead of addresses. Check each one before importing, especially if this backup came from someone else.'),
        h('ul.importlabels', ls.map(([a, l]) => h('li', h('b', l), ' ', h('code', a), mine[a] && mine[a] !== l && h('span.mut', ' (yours stays: ' + mine[a] + ')'))))],
      h('div.opts', opt('merge', 'Merge', 'Add what is missing. Nothing you already have is changed.'), opt('replace', 'Replace', 'Delete what is saved in this browser and use the backup instead.')),
      h('div.actions', h('span.grow'), h('button', { onclick: () => (incoming ? close() : exportView()) }, incoming ? 'Cancel' : 'Back'),
        h('button.primary', { onclick: () => {
          if (mode === 'replace' && !confirm('Replace the saved addresses, labels and ABIs in this browser?')) return;
          backup.apply(data, mode);
          close(); done();
        } }, 'Import')));
  };
  if (incoming) backup.parse(incoming).then(preview, (e) => (exportView(), d.prepend(bad('That link could not be read: ' + e.message))));
  else exportView();
}
