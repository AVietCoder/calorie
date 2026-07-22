'use client';
// PageShell — the <aside class="side-nav">...</aside><div class="main-wrapper">
// <header>...</header><main>{children}</main></div> skeleton every
// authenticated page repeated verbatim in the old HTML files.
import SideNav from './SideNav';
import Header from './Header';

export default function PageShell({ children }) {
  return (
    <div className="app-shell">
      <SideNav />
      <div className="main-wrapper">
        <Header />
        <main className="content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
