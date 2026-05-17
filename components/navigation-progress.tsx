'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    setProgress(15);

    const ramp1 = setTimeout(() => setProgress(45), 80);
    const ramp2 = setTimeout(() => setProgress(70), 200);
    const ramp3 = setTimeout(() => setProgress(85), 400);

    const finish = setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 200);
    }, 600);

    return () => {
      clearTimeout(ramp1);
      clearTimeout(ramp2);
      clearTimeout(ramp3);
      clearTimeout(finish);
    };
  }, [pathname, searchParams?.toString()]);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] h-0.5 pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 200ms' }}
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_rgba(240,180,41,0.6)]"
        style={{
          width: `${progress}%`,
          transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </div>
  );
}