"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Utensils } from "lucide-react";
import "./login.css";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if user previously preferred dark mode
    try {
      const theme = window.localStorage.getItem("tiffin-tracker-v1:theme");
      if (theme === "dark") document.body.classList.add("dark");
    } catch {}
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        router.push("/");
        router.refresh(); // Force a refresh to bypass any cached redirects
      } else {
        setError(data.error || "Login failed");
        setLoading(false);
      }
    } catch {
      setError("Unable to connect to the server.");
      setLoading(false);
    }
  };

  return (
    <main className="app-shell login-shell">
      <div className="login-container">
        <div className="brand login-brand">
          <div className="brand-mark"><Utensils size={18} strokeWidth={2.5} /></div>
          <div>
            <h1 className="brand-title">Tiffin Tracker</h1>
            <div className="brand-caption">Admin Access</div>
          </div>
        </div>

        <div className="panel login-panel">
          <form onSubmit={handleLogin} className="login-form">
            <h2 className="panel-title">Sign in to your account</h2>
            <p className="panel-subtitle" style={{ marginBottom: "20px" }}>
              Please enter your admin credentials to continue.
            </p>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <div className="form-control">
              <label>Username (Email)</label>
              <input
                type="email"
                className="field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin@example.com"
                required
                autoComplete="email"
                disabled={loading}
              />
            </div>

            <div className="form-control">
              <label>Password</label>
              <input
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            <button type="submit" className="button primary" disabled={loading} style={{ marginTop: "10px", height: "44px" }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
