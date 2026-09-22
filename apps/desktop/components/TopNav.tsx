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
export function TopNav() {
  const path = usePathname();
  const links = NAV.map(({href,label,icon:ItemIcon}) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}><ItemIcon size={20} color="currentColor"/><span>{label}</span></Link>);
  return <>
    <header className="gg-header"><div className="gg-header-inner">
      <Link href="/home" aria-label="Giggle home"><Wordmark/></Link>
      <nav data-testid="desktop-navigation" className="gg-main-nav" aria-label="Primary navigation">{links}</nav>
      <div className="gg-header-actions"><NotificationBell/><Link href="/profile" className="gg-profile-link" aria-label="Your profile"><PersonAvatar isMe userId={session.user?.id} name={session.user?.name ?? "You"} size={40}/></Link></div>
    </div></header>
    <nav data-testid="mobile-navigation" className="gg-mobile-nav gg-bottom-nav" aria-label="Primary navigation">{links}</nav>
  </>;
}
