/**
 * "How it's built": the app explaining itself. Each walkthrough follows one
 * feature through the code, with links to the exact lines on GitHub at the
 * commit this build came from (see build/walkthroughs/compile.ts).
 *
 * The index (titles, summaries, file lists) ships in the main bundle; the
 * walkthrough bodies are one lazy chunk, loaded when you open the first one.
 */
import { Suspense, use, type MouseEvent } from 'react';
import { commit, loadWalkthroughs, repoUrl, walkthroughs, type WalkthroughMeta } from 'virtual:walkthroughs';
import { Icon } from '../../components/Icon.tsx';
import { navigate } from '../../state/route.ts';
import { AnswerSkeleton, handleCopyClick } from '../section/Answer.tsx';

let bodies: Promise<Record<string, string>> | null = null;
const loadBodies = (): Promise<Record<string, string>> => (bodies ??= loadWalkthroughs().then((m) => m.default));

const isSha = /^[0-9a-f]{40}$/.test(commit);
const shortCommit = isSha ? commit.slice(0, 7) : commit;
const commitUrl = isSha ? `${repoUrl}/commit/${commit}` : `${repoUrl}/tree/${commit}`;

function fileUrl(path: string): string {
  return path.endsWith('/') ? `${repoUrl}/tree/${commit}/${path.slice(0, -1)}` : `${repoUrl}/blob/${commit}/${path}`;
}

function fileName(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) + (path.endsWith('/') ? '/' : '');
}

export function HowItsBuiltPage({ walkthroughId }: { walkthroughId: string | null }) {
  const index = walkthroughId ? walkthroughs.findIndex((w) => w.id === walkthroughId) : -1;
  const current = index >= 0 ? walkthroughs[index] : undefined;
  if (current) {
    return <Walkthrough key={current.id} walkthrough={current} prev={walkthroughs[index - 1]} next={walkthroughs[index + 1]} />;
  }
  return <WalkthroughIndex />;
}

function WalkthroughIndex() {
  return (
    <article className="page walk-page">
      <header className="page-header">
        <p className="eyebrow">Behind the scenes</p>
        <h1>How it's built</h1>
        <p className="lede">
          This app explains itself. Each walkthrough follows one feature from the click to the database and back: the
          architecture, the flow of logic, the reasoning behind each decision, and links to the exact lines on GitHub. The code
          you see is quoted from the build you're using (commit{' '}
          <a href={commitUrl} target="_blank" rel="noopener noreferrer">
            <code>{shortCommit}</code>
          </a>
          ), so it can't drift from what's running.
        </p>
      </header>

      {walkthroughs.length === 0 ? (
        <div className="empty">
          <p>No walkthroughs in this build yet.</p>
        </div>
      ) : (
        <ol className="round-list walk-list">
          {walkthroughs.map((walkthrough, i) => (
            <li key={walkthrough.id}>
              <a
                className="round"
                href={`#how-its-built/${walkthrough.id}`}
                onPointerEnter={() => void loadBodies()}
                onClick={(event) => {
                  event.preventDefault();
                  navigate({ name: 'howItsBuilt', walkthroughId: walkthrough.id });
                }}
              >
                <span className="round-index tabular">{String(i + 1).padStart(2, '0')}</span>
                <span className="round-body">
                  <span className="round-title">{walkthrough.title}</span>
                  <span className="round-desc">{walkthrough.summary}</span>
                  <span className="walk-tags">
                    {walkthrough.tags.map((tag) => (
                      <span key={tag} className="walk-tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="round-progress walk-meta">
                  <span className="tabular">{walkthrough.minutes} min</span>
                  <span className="tabular">{walkthrough.files.length} files</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}

      <aside className="walk-cta">
        <Icon name="pullRequest" size={20} />
        <p>
          Spotted something to improve, or want to add a question from your own interviews?{' '}
          <a
            href="#contribute"
            onClick={(event) => {
              event.preventDefault();
              navigate({ name: 'contribute' });
            }}
          >
            Contribute
          </a>
          .
        </p>
      </aside>
    </article>
  );
}

function WalkthroughBody({ id }: { id: string }) {
  const html = use(loadBodies())[id] ?? '<p>This walkthrough is missing from the build.</p>';
  return (
    <div
      className="prose walk-prose"
      onClick={(event) => void handleCopyClick(event)}
      // Safe: compiled at build time by build/walkthroughs/compile.ts, which escapes raw HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Walkthrough({ walkthrough, prev, next }: { walkthrough: WalkthroughMeta; prev?: WalkthroughMeta; next?: WalkthroughMeta }) {
  const open = (id: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate({ name: 'howItsBuilt', walkthroughId: id });
  };
  return (
    <article className="page walk-page">
      <header className="page-header">
        <a className="back-link" href="#how-its-built" onClick={(event) => {
          event.preventDefault();
          navigate({ name: 'howItsBuilt', walkthroughId: null });
        }}>
          ← How it's built
        </a>
        <h1>{walkthrough.title}</h1>
        <p className="lede">{walkthrough.summary}</p>
        <p className="walk-byline">
          <span className="tabular">{walkthrough.minutes} min read</span>
          <span aria-hidden="true">·</span>
          <span>
            Code at{' '}
            <a href={commitUrl} target="_blank" rel="noopener noreferrer">
              <code>{shortCommit}</code>
            </a>
          </span>
        </p>
      </header>

      {walkthrough.files.length > 0 ? (
        <details className="walk-files">
          <summary>
            Files in this walkthrough <span className="tabular">({walkthrough.files.length})</span>
          </summary>
          <ul>
            {walkthrough.files.map((path) => (
              <li key={path}>
                <a href={fileUrl(path)} target="_blank" rel="noopener noreferrer" title={path}>
                  <span className="walk-file-name">{fileName(path)}</span>
                  <span className="walk-file-dir">{path.slice(0, path.length - fileName(path).length)}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Suspense fallback={<AnswerSkeleton />}>
        <WalkthroughBody id={walkthrough.id} />
      </Suspense>

      <nav className="walk-pager" aria-label="More walkthroughs">
        {prev ? (
          <a href={`#how-its-built/${prev.id}`} onClick={open(prev.id)}>
            <span>Previous</span>
            {prev.title}
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={`#how-its-built/${next.id}`} onClick={open(next.id)} className="is-next">
            <span>Next</span>
            {next.title}
          </a>
        ) : null}
      </nav>
    </article>
  );
}
