// Offline test for get_ticket_with_thread: emulates Zendesk cursor pagination (page[size] max 100,
// meta.has_more, meta.after_cursor) and attachments. No network, no credentials. Run: npm test
const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.ZENDESK_SUBDOMAIN = 'mock'; process.env.ZENDESK_EMAIL = 'm'; process.env.ZENDESK_API_TOKEN = 't';
const { zendeskClient } = await import(`${repo}/src/zendesk-client.js`);
const { ticketsTools } = await import(`${repo}/src/tools/tickets.js`);
const tool = ticketsTools.find(t => t.name === 'get_ticket_with_thread');

const makeThread = (n, withAtts) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, public: i % 7 !== 3, author_id: 1, created_at: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString(),
  body: `comment body ${i + 1}`,
  attachments: withAtts && i % 2 === 0 ? [{ file_name: `big${i}.txt`, content_type: 'text/plain', size: 150000, content_url: `https://mock/att/${i}` }] : []
}));
let thread = []; let calls = 0;
zendeskClient.getTicket = async (id) => ({ ticket: { id, subject: 'mock', status: 'open', updated_at: thread.at(-1)?.created_at, tags: [] } });
zendeskClient.downloadAttachment = async () => Buffer.from('x'.repeat(150000));
zendeskClient.request = async (method, endpoint, data, params) => {
  calls++;
  if (method !== 'GET') throw new Error('write attempted');
  const size = Math.min(params['page[size]'] || 100, 100);
  const start = params['page[after]'] ? Number(params['page[after]']) : 0;
  const page = thread.slice(start, start + size);
  const end = start + page.length;
  return { comments: page, meta: { has_more: end < thread.length, after_cursor: end < thread.length ? String(end) : null } };
};
const txt = r => r.content.filter(b => b.type === 'text').map(b => b.text);
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) process.exitCode = 1; };

thread = makeThread(250, false); calls = 0;
let t = txt(await tool.handler({ id: 1, mode: 'summary' }));
check('250 comments: header says all 250 fetched, 3 pages, complete: true', t[0].includes('all 250 comments fetched across 3 page(s), complete: true'));
check('250 comments: latest comment shown is 250/250', t.some(x => x.includes('Comment 250/250')));
check('250 comments: no INCOMPLETE banner', !t.some(x => x.includes('INCOMPLETE')));
check('250 comments: 3 API page calls', calls === 3);
t = txt(await tool.handler({ id: 1, mode: 'range', comment_start: 95, comment_end: 105 }));
check('range 95–105 spans page boundary (comments 96..106)', t.some(x => x.includes('Comment 96/250')) && t.some(x => x.includes('Comment 106/250')));

thread = makeThread(100, false);
t = txt(await tool.handler({ id: 1 }));
check('exactly 100 comments: complete: true, 1 page', t[0].includes('all 100 comments fetched across 1 page(s), complete: true'));

thread = makeThread(250, false);
const orig = zendeskClient.getAllTicketComments.bind(zendeskClient);
zendeskClient.getAllTicketComments = (id) => orig(id, { maxPages: 1 });
t = txt(await tool.handler({ id: 1, mode: 'summary' }));
check('safety cap hit: header says INCOMPLETE, complete: false', t[0].includes('INCOMPLETE') && t[0].includes('complete: false'));
check('safety cap hit: banner + footer both warn', t.some(x => x.includes('INCOMPLETE THREAD')) && t.at(-1).includes('complete: false'));
zendeskClient.getAllTicketComments = orig;

thread = makeThread(11, true);
let r = await tool.handler({ id: 1 });
t = txt(r);
check('attachments default off: all 11 comments present', t.filter(x => x.startsWith('\n--- Comment ')).length === 11);
check('attachments default off: none inlined', t.some(x => x.includes('include_attachments=false')) && !t.some(x => x.length > 100000));
r = await tool.handler({ id: 1, include_attachments: true });
t = txt(r);
const total = t.join('').length;
check('attachments on: all 11 comments still present', t.filter(x => x.startsWith('\n--- Comment ')).length === 11);
check('attachments on: later attachments listed as "budget reached"', t.some(x => x.includes('response budget max_total_chars=80000 reached')));
console.log(`      (attachments-on response size: ${total} chars; one 150k attachment inlined before budget stop)`);
