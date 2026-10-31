import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

const statuses = ["open", "in_progress", "resolved"] as const;
const priorities = ["low", "medium", "high"] as const;
type Status = (typeof statuses)[number];
type Priority = (typeof priorities)[number];

type Ticket = {
  _id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type TicketPage = { items: Ticket[]; total: number; page: number; limit: number };
type Summary = {
  total: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
};
type Draft = Omit<Ticket, "_id" | "tags" | "createdAt" | "updatedAt"> & { tags: string };
type Notice = { text: string } | null;

const statusLabels: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};
const priorityLabels: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function emptyDraft(): Draft {
  return { title: "", description: "", status: "open", priority: "medium", tags: "" };
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m10 6 6 6-6 6" />,
    edit: <><path d="m14 5 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-5-5L4 14v6Z" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    ticket: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    circle: <circle cx="12" cy="12" r="8" />,
    progress: <><path d="M12 4a8 8 0 1 0 8 8M12 4v8h8" /></>,
    key: <><circle cx="8" cy="8" r="5" /><path d="m11.5 11.5 9 9M16 16l3-3M19 19l3-3" /></>,
    filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.ticket}</svg>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTicket(value: unknown): value is Ticket {
  return isRecord(value) && typeof value._id === "string" && typeof value.title === "string"
    && typeof value.description === "string" && statuses.includes(value.status as Status)
    && priorities.includes(value.priority as Priority) && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === "string")
    && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers: { Accept: "application/json", ...options.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("We couldn’t reach the server. Please try again in a moment.");
  }
  if (response.status === 204 && response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server sent an unexpected response. Please try again.");
  }
  if (!response.ok) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string"
      ? body.error.message : "The request could not be completed. Please try again.";
    throw new Error(message);
  }
  return body;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric",
  }).format(date);
}

function TicketRow({ ticket, selected, canWrite, busy, onEdit, onStatus, onDelete }: {
  ticket: Ticket;
  selected: boolean;
  canWrite: boolean;
  busy: boolean;
  onEdit: (ticket: Ticket) => void;
  onStatus: (ticket: Ticket, status: Status) => void;
  onDelete: (ticket: Ticket) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const confirmationId = `delete-${ticket._id}`;
  return <li className={`ticket-row${selected ? " is-selected" : ""}`}>
    <div className="ticket-main">
      <div className="ticket-eyebrow">
        <span className="ticket-id">#{ticket._id.slice(-6).toUpperCase()}</span>
        <span className={`priority priority-${ticket.priority}`}><span className="priority-dot" />{priorityLabels[ticket.priority]} priority</span>
      </div>
      <button type="button" className="ticket-title" onClick={() => onEdit(ticket)} disabled={busy}>{ticket.title}</button>
      <p className={`ticket-description${ticket.description ? "" : " is-muted"}`}>{ticket.description || "No description added."}</p>
      <div className="ticket-footer">
        {ticket.tags.length > 0 && <div className="tag-list" aria-label="Tags">{ticket.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}
        <span className="ticket-date">Updated <time dateTime={ticket.updatedAt}>{formatDate(ticket.updatedAt)}</time></span>
      </div>
    </div>
    <div className="ticket-actions">
      <select className={`status-select status-${ticket.status}`} aria-label={`Status for ${ticket.title}`} aria-describedby={!canWrite ? "write-key-help" : undefined} value={ticket.status} disabled={!canWrite || busy} onChange={(event) => onStatus(ticket, event.target.value as Status)}>
        {statuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
      </select>
      <div className="row-buttons">
        <button type="button" className="row-action" onClick={() => onEdit(ticket)} disabled={busy}><Icon name="edit" size={15} /><span>Edit</span></button>
        <button type="button" className="icon-button delete-trigger" ref={deleteRef} aria-label={`Delete ${ticket.title}`} aria-expanded={confirming} aria-controls={confirming ? confirmationId : undefined} onClick={() => setConfirming(true)} disabled={busy}><Icon name="trash" size={16} /></button>
      </div>
    </div>
    {confirming && <div className="delete-confirmation" id={confirmationId} role="group" aria-labelledby={`${confirmationId}-title`}>
      <div><strong id={`${confirmationId}-title`}>Delete this ticket?</strong><p>“{ticket.title}” will be permanently removed.</p>{!canWrite && <p className="write-reminder">Enter your write key in the ticket form to delete it.</p>}</div>
      <div className="confirmation-actions">
        <button type="button" className="button button-quiet" ref={cancelRef} onClick={() => setConfirming(false)} disabled={busy}>Keep ticket</button>
        <button type="button" className="button button-danger" onClick={() => void onDelete(ticket)} disabled={!canWrite || busy}>Delete ticket</button>
      </div>
    </div>}
  </li>;
}

export default function App() {
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(8);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [tickets, setTickets] = useState<TicketPage | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState("");
  const [writeKey, setWriteKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [writing, setWriting] = useState(false);
  const writeLock = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const canWrite = writeKey.trim().length > 0;

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (statusFilter) query.set("status", statusFilter);
    if (priorityFilter) query.set("priority", priorityFilter);
    void request(`/api/tickets?${query.toString()}`, { signal: controller.signal }).then((body) => {
      if (controller.signal.aborted) return;
      if (!isRecord(body) || !Array.isArray(body.items) || !body.items.every(isTicket)
        || typeof body.total !== "number" || typeof body.page !== "number" || typeof body.limit !== "number") {
        throw new Error("The ticket list could not be read. Please try again.");
      }
      const result = body as TicketPage;
      const lastPage = Math.max(1, Math.ceil(result.total / limit));
      if (page > lastPage) setPage(lastPage);
      setTickets(result);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setListError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false);
    });
    return () => controller.abort();
  }, [statusFilter, priorityFilter, page, limit, refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError("");
    void request("/api/reports/summary", { signal: controller.signal }).then((body) => {
      if (controller.signal.aborted) return;
      if (!isRecord(body) || typeof body.total !== "number" || !isRecord(body.byStatus) || !isRecord(body.byPriority)
        || !statuses.every((status) => typeof (body.byStatus as Record<string, unknown>)[status] === "number")
        || !priorities.every((priority) => typeof (body.byPriority as Record<string, unknown>)[priority] === "number")) {
        throw new Error("The workspace totals could not be read. Please try again.");
      }
      setSummary(body as Summary);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) { setSummary(null); setSummaryError(errorMessage(error)); }
    }).finally(() => {
      if (!controller.signal.aborted) setSummaryLoading(false);
    });
    return () => controller.abort();
  }, [refreshVersion]);

  function refresh() { setRefreshVersion((value) => value + 1); }
  function clearFilters() { setStatusFilter(""); setPriorityFilter(""); setPage(1); }
  function newTicket() {
    if (writing) return;
    setEditingId(null); setDraft(emptyDraft()); setFormError("");
    titleRef.current?.focus();
  }
  function editTicket(ticket: Ticket) {
    if (writing) return;
    setEditingId(ticket._id);
    setDraft({ title: ticket.title, description: ticket.description, status: ticket.status, priority: ticket.priority, tags: ticket.tags.join(", ") });
    setFormError("");
    titleRef.current?.focus();
  }

  async function write(method: string, path: string, payload?: unknown) {
    const headers: Record<string, string> = { "X-API-Key": writeKey.trim() };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    return request(path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writeLock.current) return;
    setFormError(""); setNotice(null);
    if (!canWrite) { setFormError("Enter your write key before saving a ticket."); return; }
    const title = draft.title.trim();
    const tags = [...new Set(draft.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    if (!title || title.length > 140) { setFormError("Add a title between 1 and 140 characters."); return; }
    if (draft.description.length > 3000) { setFormError("Keep the description to 3,000 characters or fewer."); return; }
    if (tags.length > 8 || tags.some((tag) => tag.length > 32)) { setFormError("Use up to eight tags, with 32 characters or fewer in each."); return; }
    const payload = { title, description: draft.description, status: draft.status, priority: draft.priority, tags };
    writeLock.current = true; setWriting(true);
    try {
      const body = await write(editingId ? "PATCH" : "POST", editingId ? `/api/tickets/${encodeURIComponent(editingId)}` : "/api/tickets", payload);
      if (!isRecord(body) || !isTicket(body.item)) throw new Error("The save response could not be read. Refresh the list before trying again.");
      setNotice({ text: editingId ? "Ticket updated." : "Ticket created." });
      setFormError(""); setActionError("");
      if (editingId) {
        const item = body.item;
        setDraft({ title: item.title, description: item.description, status: item.status, priority: item.priority, tags: item.tags.join(", ") });
      } else {
        setDraft(emptyDraft()); setPage(1);
      }
      refresh();
    } catch (error) { setFormError(errorMessage(error)); }
    finally { writeLock.current = false; setWriting(false); }
  }

  async function updateStatus(ticket: Ticket, status: Status) {
    if (!canWrite || writeLock.current || status === ticket.status) return;
    writeLock.current = true; setWriting(true); setActionError(""); setNotice(null);
    try {
      const body = await write("PATCH", `/api/tickets/${encodeURIComponent(ticket._id)}`, { status });
      if (!isRecord(body) || !isTicket(body.item)) throw new Error("The update response could not be read. Refresh the list before trying again.");
      if (editingId === ticket._id) setDraft((value) => ({ ...value, status }));
      setNotice({ text: `Ticket moved to ${statusLabels[status].toLowerCase()}.` });
      refresh();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { writeLock.current = false; setWriting(false); }
  }

  async function deleteTicket(ticket: Ticket) {
    if (!canWrite || writeLock.current) return;
    writeLock.current = true; setWriting(true); setActionError(""); setNotice(null);
    try {
      await write("DELETE", `/api/tickets/${encodeURIComponent(ticket._id)}`);
      if (editingId === ticket._id) { setEditingId(null); setDraft(emptyDraft()); setFormError(""); }
      setNotice({ text: "Ticket deleted." });
      refresh(); listHeadingRef.current?.focus();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { writeLock.current = false; setWriting(false); }
  }

  const totalPages = Math.max(1, Math.ceil((tickets?.total ?? 0) / limit));
  const hasFilters = Boolean(statusFilter || priorityFilter);
  const cards = [
    { label: "Total tickets", value: summary?.total, icon: "grid", tone: "navy", detail: summary ? `${summary.byPriority.high} high priority` : "Across your workspace" },
    { label: "Open", value: summary?.byStatus.open, icon: "circle", tone: "blue", detail: "Ready for a closer look" },
    { label: "In progress", value: summary?.byStatus.in_progress, icon: "progress", tone: "amber", detail: "Work is underway" },
    { label: "Resolved", value: summary?.byStatus.resolved, icon: "check", tone: "green", detail: "Wrapped up and recorded" },
  ];

  return <div className="app-shell">
    <a className="skip-link" href="#ticket-workspace">Skip to tickets</a>
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="/" aria-label="Issue Ledger home"><span className="brand-mark"><Icon name="ticket" size={22} /></span><span>Issue<span className="brand-light">Ledger</span></span></a>
        <span className="workspace-label"><span />Support workspace</span>
        <button type="button" className="button button-header" onClick={refresh} disabled={listLoading || summaryLoading || writing}><Icon name="refresh" /><span>Refresh</span></button>
      </div>
    </header>
    <main className="main-container">
      <section className="page-heading" aria-labelledby="page-title">
        <div><p className="eyebrow">THE SUPPORT DESK</p><h1 id="page-title">Every issue, in focus.</h1><p className="page-description">A little clarity for your queue. Capture the details and keep work moving.</p></div>
        <button type="button" className="button button-primary new-ticket-button" onClick={newTicket} disabled={writing}><Icon name="plus" />New ticket</button>
      </section>

      <section className="summary-section" aria-label="Workspace totals" aria-busy={summaryLoading}>
        <div className="section-overline"><span>Workspace overview</span><span>Totals across all tickets</span></div>
        <div className="summary-grid">{cards.map((card) => <article className={`summary-card summary-${card.tone}`} key={card.label}><div className="summary-top"><span>{card.label}</span><span className="summary-icon"><Icon name={card.icon} /></span></div><strong className={summaryLoading ? "summary-number is-refreshing" : "summary-number"}>{card.value === undefined ? "—" : card.value.toLocaleString()}</strong><p>{card.detail}</p></article>)}</div>
        {summaryError && <div className="inline-alert" role="alert"><span>Totals unavailable. {summaryError}</span><button type="button" onClick={refresh}>Try again</button></div>}
      </section>

      {notice && <div className="notice" role="status"><span><Icon name="check" />{notice.text}</span><button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}

      <div className="workspace-grid" id="ticket-workspace">
        <section className="panel tickets-panel" aria-labelledby="tickets-heading">
          <div className="panel-heading"><div><div className="heading-with-count"><h2 id="tickets-heading" ref={listHeadingRef} tabIndex={-1}>Ticket queue</h2>{!listLoading && !listError && tickets && <span className="count-badge">{tickets.total}</span>}</div><p>Small steps. Clear priorities. Steady progress.</p></div><span className="panel-heading-icon"><Icon name="ticket" size={21} /></span></div>
          <div className="filter-bar">
            <span className="filter-icon"><Icon name="filter" size={17} /></span>
            <label className="filter-field"><span>Status</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as Status | ""); setPage(1); }}><option value="">All statuses</option>{statuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></label>
            <label className="filter-field"><span>Priority</span><select value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value as Priority | ""); setPage(1); }}><option value="">All priorities</option>{[...priorities].reverse().map((priority) => <option value={priority} key={priority}>{priorityLabels[priority]}{summary ? ` (${summary.byPriority[priority]})` : ""}</option>)}</select></label>
            {hasFilters && <button type="button" className="clear-filters" onClick={clearFilters}>Clear filters</button>}
          </div>
          {actionError && <div className="inline-alert action-alert" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss ticket action error" onClick={() => setActionError("")}><Icon name="close" size={16} /></button></div>}
          <div className="ticket-results" aria-busy={listLoading}>
            {listLoading ? <div className="loading-list" role="status"><span className="sr-only">Loading tickets</span>{[0, 1, 2, 3].map((value) => <div className="ticket-skeleton" key={value} aria-hidden="true"><span /><span /><span /></div>)}</div>
              : listError ? <div className="empty-state error-state" role="alert"><span className="empty-icon"><Icon name="ticket" size={28} /></span><h3>Tickets couldn’t be loaded</h3><p>{listError}</p><button type="button" className="button button-secondary" onClick={refresh}><Icon name="refresh" size={16} />Try again</button></div>
                : !tickets || tickets.items.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="ticket" size={30} /></span><h3>{hasFilters ? "No tickets match these filters" : "Start with your first ticket"}</h3><p>{hasFilters ? "Try another status or priority to see more of your queue." : "Add the details, choose a priority, and give the issue a place to land."}</p><button type="button" className="button button-secondary" onClick={hasFilters ? clearFilters : () => titleRef.current?.focus()}>{hasFilters ? "Clear filters" : "Create a ticket"}</button></div>
                  : <ul className="ticket-list">{tickets.items.map((ticket) => <TicketRow key={ticket._id} ticket={ticket} selected={editingId === ticket._id} canWrite={canWrite} busy={writing} onEdit={editTicket} onStatus={(item, status) => void updateStatus(item, status)} onDelete={deleteTicket} />)}</ul>}
          </div>
          <footer className="pagination">
            <label className="page-size"><span>Per page</span><select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}><option value={8}>8</option><option value={12}>12</option><option value={20}>20</option></select></label>
            <div className="page-controls"><span>{!listLoading && !listError && tickets ? `Page ${page} of ${totalPages}` : "—"}</span><button type="button" className="icon-button page-button" aria-label="Previous page" disabled={listLoading || Boolean(listError) || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><Icon name="left" size={17} /></button><button type="button" className="icon-button page-button" aria-label="Next page" disabled={listLoading || Boolean(listError) || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}><Icon name="right" size={17} /></button></div>
          </footer>
        </section>

        <aside className="panel editor-panel" aria-labelledby="editor-heading">
          <div className="panel-heading"><div><p className="editor-eyebrow">{editingId ? `EDITING #${editingId.slice(-6).toUpperCase()}` : "MAKE IT ACTIONABLE"}</p><h2 id="editor-heading">{editingId ? "Edit ticket" : "Create a ticket"}</h2></div><span className="editor-heading-icon"><Icon name={editingId ? "edit" : "plus"} size={21} /></span></div>
          <form onSubmit={(event) => void submitTicket(event)} className="ticket-form">
            <fieldset disabled={writing} className="form-fields">
              <div className="form-field"><label htmlFor="ticket-title">Title <span className="required-mark">*</span></label><input id="ticket-title" ref={titleRef} required maxLength={140} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="What needs attention?" /><span className="field-counter">{draft.title.length}/140</span></div>
              <div className="form-field"><label htmlFor="ticket-description">Description <span className="optional-label">optional</span></label><textarea id="ticket-description" rows={5} maxLength={3000} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} placeholder="Add the context, steps to reproduce, or the outcome you need." /></div>
              <div className="form-row"><div className="form-field"><label htmlFor="ticket-status">Status</label><select id="ticket-status" value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Status }))}>{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div><div className="form-field"><label htmlFor="ticket-priority">Priority</label><select id="ticket-priority" value={draft.priority} onChange={(event) => setDraft((value) => ({ ...value, priority: event.target.value as Priority }))}>{priorities.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></div></div>
              <div className="form-field"><label htmlFor="ticket-tags">Tags <span className="optional-label">optional</span></label><input id="ticket-tags" value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="billing, dashboard, bug" aria-describedby="tags-help" /><p className="field-help" id="tags-help">Separate tags with commas. Up to 8 tags, 32 characters each.</p></div>
            </fieldset>
            <div className="access-section"><div className="access-heading"><Icon name="key" size={16} /><label htmlFor="write-key">Write access key</label><span className={`access-state${canWrite ? " has-key" : ""}`}>{canWrite ? "Key entered" : "Read only"}</span></div><div className="key-input-wrap"><input id="write-key" type={showKey ? "text" : "password"} value={writeKey} onChange={(event) => setWriteKey(event.target.value)} placeholder="Enter your key" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="write-key-help key-memory-help" /><button type="button" className="show-key" onClick={() => setShowKey((value) => !value)} aria-pressed={showKey} aria-label={showKey ? "Hide write access key" : "Show write access key"}>{showKey ? "Hide" : "Show"}</button></div><p className="field-help" id="write-key-help">Enter your write key to create or update tickets.</p><p className="key-memory-help" id="key-memory-help">Kept only while this page is open.</p>{canWrite && <button type="button" className="clear-key" onClick={() => { setWriteKey(""); setShowKey(false); }}>Clear key</button>}</div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <div className="form-actions"><button type="submit" className="button button-primary submit-button" disabled={!canWrite || writing}>{writing ? <><span className="spinner" />Saving…</> : <><Icon name={editingId ? "check" : "plus"} size={17} />{editingId ? "Save changes" : "Create ticket"}</>}</button>{editingId && <button type="button" className="button button-quiet" onClick={newTicket} disabled={writing}>Cancel edit</button>}</div>
          </form>
          <div className="editor-note"><span className="note-dot" /><p>Good tickets make the next step clear.<br /><span>A little context goes a long way.</span></p></div>
        </aside>
      </div>
      <footer className="app-footer"><span>Issue Ledger</span><p>A home for the details that move work forward.</p><span className="footer-dots"><i /><i /><i /></span></footer>
    </main>
  </div>;
}
