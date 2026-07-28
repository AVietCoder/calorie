'use client';
// PageShell — the <aside class="side-nav">...</aside><div class="main-wrapper">
// <header>...</header><main>{children}</main></div> skeleton every
// authenticated page repeated verbatim in the old HTML files.
import SideNav from './SideNav';
import Header from './Header';

// `variant` scopes a page's custom layout so its CSS can target
// `.app-shell--<variant>` / `.content--<variant>` instead of the GLOBAL
// `.app-shell`/`.content`. This prevents a page stylesheet (e.g. chat's 2-col
// grid, setup's flex) from leaking onto every other page once its CSS chunk is
// loaded — the root cause of the production-only Household/Diet layout break.
export default function PageShell({ children, variant }) {
  const shellClass = variant ? `app-shell app-shell--${variant}` : 'app-shell';
  const contentClass = variant ? `content content--${variant}` : 'content';
  return (
    <div className={shellClass}>
      <SideNav />
      <div className="main-wrapper">
        <Header />
        <main className={contentClass} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
