"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from './Brand';
import { Icon } from './Icons';
import { NotificationBell } from './NotificationBell';
import { PersonAvatar } from './PersonAvatar';
import { session } from '@giggle/core';
import { WEB_DISCOVERY_ENABLED } from '@/lib/discovery';

const NAV = [
  { href:'/home', label:'Home', icon:Icon.home },
  ...(WEB_DISCOVERY_ENABLED ? [{ href:'/discover', label:'Discover', icon:Icon.discover }] : []),
  { href:'/friends', label:'Friends', icon:Icon.users },
  { href:'/profile', label:'You', icon:Icon.profile },
];

/* Nav links carry the mock skin hooks: desktop tabs are `.tab`, the phone
 * bottom bar items are `.tb`, and the current route adds `is-active`
 * (alongside the existing aria-current the app CSS keys off). */
function navLinks(path: string, kind: 'tab' | 'tb') {
  return NAV.map(({href,label,icon:ItemIcon}) => (
    <Link
      key={href}
      href={href}
      aria-current={path === href ? 'page' : undefined}
      className={`${kind}${path === href ? ' is-active' : ''}`}
    >
      <ItemIcon size={20} color="currentColor"/><span>{label}</span>
    </Link>
  ));
}

export function TopNav() {
  const path = usePathname();
  return <>
    <header className="gg-header nav"><div className="gg-header-inner">
      <Link href="/home" aria-label="Giggle home" className="brand"><Wordmark/></Link>
      <nav data-testid="desktop-navigation" className="gg-main-nav tabs" aria-label="Primary navigation">{navLinks(path, 'tab')}</nav>
      <div className="gg-header-actions nav-end"><NotificationBell/><Link href="/profile" className="gg-profile-link" aria-label="Your profile"><PersonAvatar isMe userId={session.user?.id} name={session.user?.name ?? "You"} size={40} className="me"/></Link></div>
    </div></header>
    <nav data-testid="mobile-navigation" className="gg-mobile-nav gg-bottom-nav tabbar" aria-label="Primary navigation">{navLinks(path, 'tb')}</nav>
  </>;
}
