import { useEffect, useState } from 'react';
export function useEmailCooldown() {
  const [deadline, setDeadline] = useState(0),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return {
    remaining: Math.max(0, Math.ceil((deadline - now) / 1000)),
    start: () => {
      setNow(Date.now());
      setDeadline(Date.now() + 60000);
    },
  };
}
