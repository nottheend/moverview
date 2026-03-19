import React, { useEffect, useState } from 'react';
import { auth } from './api.js';
import DashboardPage from './pages/DashboardPage.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still loading

  useEffect(() => {
    auth.me()
      .then((data) => setUser(data.user))
      .catch(() => {
        // In production: server redirects to Cloudron login automatically.
        // In dev: server auto-logs in, so this should never fire.
        setUser(null);
      });
  }, []);

  async function handleLogout() {
    await auth.logout();
    // In production, Cloudron manages the session — redirect to Cloudron logout.
    // In dev, just reload.
    window.location.href = '/api/auth/logout';
  }

  if (user === undefined) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        Redirecting to login…
      </div>
    );
  }

  return <DashboardPage user={user} onLogout={handleLogout} />;
}
