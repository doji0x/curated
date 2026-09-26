import React from 'react';
import { MessageSquare, Rocket, User } from 'lucide-react';
import { Image } from '@/components/ui/image';
import { Link, useLocation } from 'react-router-dom';
import { usePhantomWallet } from '@/contexts/PhantomWalletContext';

export default function ValidateBottomBar() {
  const { pathname } = useLocation();
  const { address } = usePhantomWallet();
  const tabs = [
    { to: '/', label: 'Burn', logo: true, active: pathname === '/' },
    { to: '/launch-coin', label: 'Launch', icon: Rocket, active: pathname === '/launch-coin' },
    { to: '/feed', label: 'Feed', icon: MessageSquare, active: pathname === '/feed' },
    { to: address ? `/profile/${address}` : '/feed', label: 'Profile', icon: User, active: pathname.startsWith('/profile/') }
  ];
  return <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
    <div className="mx-auto grid h-16 max-w-md grid-cols-4">{tabs.map(tab => { const Icon = tab.icon; return <Link key={tab.label} to={tab.to} aria-label={tab.label} className={`relative flex h-full flex-col items-center justify-center gap-1 transition ${tab.active ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}>{tab.active && <span className="absolute top-1.5 h-1 w-1 rounded-full bg-primary" />}{tab.logo ? <Image src="https://media.base44.com/images/public/6aa8d3c82020abebe308c467/b4b8f84ae_Screenshot2026-09-26at125609PM.png" alt="" className={`h-5 w-5 rounded ${tab.active ? 'ring-1 ring-primary/60' : 'grayscale opacity-60'}`} /> : <Icon className="h-5 w-5" />}<span className="text-[9px] font-medium">{tab.label}</span></Link>; })}</div>
  </nav>;
}