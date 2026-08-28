---
theme: default
title: "Qubu: build it in pieces"
info: A short story about composable SQL and schema change
author: Qubu
aspectRatio: 16/9
canvasWidth: 1600
transition: fade
---

<div class="story-cover">
  <div class="eyebrow">QUBU / A SQL STORY</div>
  <h1>Build it in pieces.<br /><span>Keep the meaning.</span></h1>
  <p class="lede">A composable way to build queries, understand schemas, and change databases without losing the plot.</p>
  <div class="cover-mark" aria-hidden="true">
    <span class="mark-dot dot-a"></span>
    <span class="mark-dot dot-b"></span>
    <span class="mark-dot dot-c"></span>
    <span class="mark-line line-a"></span>
    <span class="mark-line line-b"></span>
    <span class="mark-line line-c"></span>
  </div>
  <div class="cover-footer"><span>Qubu</span><span>SQL that stays composable</span></div>
</div>

---

<div class="eyebrow">THE FRICTION</div>
<h2>SQL is readable.<br /><span class="accent-coral">The glue around it gets weird.</span></h2>

<div class="split-story">
  <div>
    <p class="big-copy">The first query is easy. Then the query becomes a report, a reusable source, a write, a dialect edge case, and a schema change.</p>
    <p class="muted">Suddenly, the same idea has five different homes. Every new abstraction asks you to translate.</p>
  </div>
  <div class="messy-stack" aria-label="A stack of disconnected abstractions">
    <div class="stack-card stack-top"><span>query builder</span><b>SELECT ...</b></div>
    <div class="stack-card stack-mid"><span>schema model</span><b>table + types</b></div>
    <div class="stack-card stack-low"><span>migration tool</span><b>diff + SQL</b></div>
    <div class="stack-card stack-note">same intent<br /><strong>different language</strong></div>
  </div>
</div>

---

<div class="eyebrow">THE IDEA</div>
<h2>Start with pieces<br /><span class="accent-lime">that know what they are.</span></h2>

<div class="card-grid four">
  <div class="idea-card">
    <div class="card-kicker">01 / SOURCES</div>
    <h3>Tables and columns</h3>
    <code>users.email</code>
    <p>A real source, not a string with good intentions.</p>
  </div>
  <div class="idea-card">
    <div class="card-kicker">02 / MEANING</div>
    <h3>Expressions</h3>
    <code>eq(users.id, 42)</code>
    <p>Values, nullability, and scope travel with the piece.</p>
  </div>
  <div class="idea-card">
    <div class="card-kicker">03 / SHAPE</div>
    <h3>Clauses</h3>
    <code>where(...) · orderBy(...)</code>
    <p>Build the query in the order your brain gets there.</p>
  </div>
  <div class="idea-card">
    <div class="card-kicker">04 / POLICY</div>
    <h3>Dialects</h3>
    <code>postgresDialect()</code>
    <p>Keep the differences visible at the edge.</p>
  </div>
</div>

---

<div class="eyebrow">COMPOSABILITY</div>
<h2>Pieces stay useful<br /><span class="accent-cyan">when they move.</span></h2>

<div class="composition-layout">
  <div class="code-window">
    <div class="window-bar"><span></span><span></span><span></span><label>report.ts</label></div>
    <pre>const activeUsers = cte(
  'active_users',
  select(
    { id: users.id, name: users.name },
    from(users),
    where(isNotNull(users.email)),
  ),
)
const report = select(
  { displayName: activeUsers.name },
  withCte(activeUsers),
  from(activeUsers),
)</pre>
  </div>
  <div class="composition-notes">
    <div class="note-row"><span class="number">1</span><p>A query can become a source.</p></div>
    <div class="note-row"><span class="number">2</span><p>That source can feed the next query.</p></div>
    <div class="note-row"><span class="number">3</span><p>The result shape stays known as it moves.</p></div>
  </div>
</div>

<div class="bottom-line">No giant mutable builder. No restart from scratch.</div>

---

<div class="eyebrow">ONE MODEL, MANY SHAPES</div>
<h2>Read. Write. Extend.<br /><span class="accent-lime">Keep the same building blocks.</span></h2>

<div class="shape-row">
  <div class="shape-card shape-query">
    <div class="shape-label">READ</div>
    <pre>select(
  { name: users.name },
  from(users),
  where(...),
)</pre>
    <p>Queries stay close to SQL.</p>
  </div>
  <div class="shape-card shape-write">
    <div class="shape-label">WRITE</div>
    <pre>update(users)
  .set({ name })
  .where(eq(users.id, id))</pre>
    <p>Writes use the same schema facts.</p>
  </div>
  <div class="shape-card shape-extension">
    <div class="shape-label">EXTEND</div>
    <pre>customClause({
  name: 'fetch-with-ties',
  render(context) { ... },
})</pre>
    <p>Unusual SQL gets a clean escape hatch.</p>
  </div>
</div>

---

<div class="eyebrow">DIALECTS</div>
<h2>Compose once.<br /><span class="accent-coral">Respect the database you picked.</span></h2>

<div class="dialect-layout">
  <div class="dialect-code">
    <div class="code-label">same query / different policy</div>
    <pre>const query = select(
  { id: users.id },
  from(users),
  where(eq(users.id, 42)),
)</pre>
  </div>
  <div class="dialect-list">
    <div class="dialect-item"><span class="dialect-dot pg"></span><div><strong>PostgreSQL</strong><small>$1, $2, ...</small></div></div>
    <div class="dialect-item"><span class="dialect-dot sqlite"></span><div><strong>SQLite</strong><small>?, ?, ...</small></div></div>
    <div class="dialect-item"><span class="dialect-dot mysql"></span><div><strong>MySQL</strong><small>?, ?, ...</small></div></div>
  </div>
</div>

<p class="wide-note">The query stays the same. Quoting, placeholders, JSON rules, pagination, and schema details live in the dialect policy.</p>

---

<div class="eyebrow">THE SECOND LIFE OF A SCHEMA</div>
<h2>Your database is not a blank canvas.<br /><span class="accent-cyan">Qubu can look at what is already there.</span></h2>

<div class="inspect-layout">
  <div class="inspect-panel">
    <div class="inspect-title"><span class="pulse"></span> selected namespace</div>
    <div class="inspect-db">production / public</div>
    <div class="inspect-row"><span>tables</span><b>18</b></div>
    <div class="inspect-row"><span>views</span><b>6</b></div>
    <div class="inspect-row"><span>keys + checks</span><b>43</b></div>
    <div class="inspect-row"><span>unknown facts</span><b class="warning">2</b></div>
  </div>
  <div class="inspect-copy">
    <p class="big-copy">Qubu reads PostgreSQL, SQLite, or MySQL through a connection you own.</p>
    <p class="muted">It turns catalog facts into a clean snapshot. Names, constraints, views, indexes, defaults, and the details that make each database different stay attached to the data.</p>
    <div class="tag-row"><span>catalog facts</span><span>snapshots</span><span>evidence</span></div>
  </div>
</div>

---

<div class="eyebrow">CHANGE, WITH A PAPER TRAIL</div>
<h2>When the schema changes,<br /><span class="accent-lime">the next move is visible.</span></h2>

```mermaid
flowchart LR
  A[Current database] --> B[Snapshot]
  C[Schema in code] --> D[Target snapshot]
  B --> E[Diff]
  D --> E
  E --> F[Reviewable plan]
  F --> G[Dialect SQL]
  G --> H[Your runner]
  classDef source fill:#151d2b,stroke:#7b8aa5,color:#f6f7ef
  classDef focus fill:#d8ff61,stroke:#d8ff61,color:#10151f
  classDef output fill:#70e6f5,stroke:#70e6f5,color:#10151f
  class A,C source
  class B,D,E,F focus
  class G,H output
```

<div class="diagram-caption">Qubu describes the change. You decide when it runs.</div>

---

<div class="eyebrow">NO GUESSING GAMES</div>
<h2>If Qubu does not know,<br /><span class="accent-coral">it leaves the question visible.</span></h2>

<div class="guardrail-grid">
  <div class="guardrail"><div class="guardrail-icon">?</div><h3>Unknown stays unknown</h3><p>Opaque catalog text is kept as data. It is never quietly turned into SQL.</p></div>
  <div class="guardrail"><div class="guardrail-icon">!</div><h3>Risk gets a label</h3><p>Destructive, unsupported, or review-required changes stop for a decision.</p></div>
  <div class="guardrail"><div class="guardrail-icon">→</div><h3>Custom stays explicit</h3><p>When you need a special step, attach the SQL, reason, dialect, and place in the plan.</p></div>
</div>

<div class="bottom-line">The tool can be opinionated without pretending to be omniscient.</div>

---

<div class="story-close">
  <div class="eyebrow">QUBU</div>
  <h2>I want SQL that<br /><span class="accent-lime">keeps its shape.</span></h2>
  <p class="closing-copy">Small pieces. Composable queries. A schema I can inspect, compare, and change on purpose.</p>
  <div class="closing-rule"></div>
  <div class="closing-meta"><span>build with fragments</span><span>keep the database yours</span></div>
</div>
