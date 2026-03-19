import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { auth } from './api.js';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const navigate = useNavigate();

  useEffect(() => {
    auth.me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function handleLogin(username, password) {
    const data = await auth.login(username, password);
    setUser(data.user);
    navigate('/');
  }

  async function handleLogout() {
    await auth.logout();
    setUser(null);
    navigate('/login');
  }

  if (user === undefined) {
    // Still checking session
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />}
      />
      <Route
        path="/*"
        element={
          user
            ? <DashboardPage user={user} onLogout={handleLogout} />
            : <Navigate to="/login" replace />
        }
      />
    </Routes>
  );
}
