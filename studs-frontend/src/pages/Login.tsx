import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:3001/auth/login', { email, password });
      const { access_token, user } = res.data;

      console.log("=== LOGIN SUCCESS ===");
      console.log("User object:", user);
      console.log("Role received:", user?.role);

      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(user));

      // Role-based redirect
      if (user?.role === 'RIDER') {
        navigate('/rider');
      } else if (user?.role === 'VENDOR') {
        navigate('/vendor/dashboard');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      console.error("Login error:", err.response?.data || err);
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #05060f, #1a1a2e)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      color: '#f8fafc'
    }}>
      <div style={{ width: '100%', maxWidth: '460px' }}>
        {/* Modern Logo */}
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <div style={{
            fontSize: 'clamp(84px, 26vw, 140px)',
            fontWeight: '900',
            background: 'linear-gradient(90deg, #f472b6, #fb923c, #facc15)',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            lineHeight: '0.8',
            marginBottom: '-30px',
            letterSpacing: '-8px'
          }}>S</div>
          <h1 style={{ fontSize: 'clamp(38px, 9vw, 58px)', fontWeight: '900', letterSpacing: '-3px', margin: '0' }}>STUDS</h1>
          <p style={{ color: '#e0e7ff', fontSize: '20px', marginTop: '8px' }}>Campus Delivery</p>
        </div>

        <div style={{
          background: 'rgba(26, 26, 46, 0.95)',
          padding: 'clamp(32px, 7vw, 60px) clamp(20px, 6vw, 52px)',
          borderRadius: '32px',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(244, 114, 182, 0.15)'
        }}>
          <h2 style={{ textAlign: 'center', marginBottom: '40px', fontSize: '32px' }}>Welcome Back</h2>

          {error && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '24px' }}>{error}</p>}

          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="yourname@ug.edu.gh"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              required
            />

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '22px',
                background: 'linear-gradient(90deg, #f472b6, #fb923c)',
                border: 'none',
                borderRadius: '9999px',
                fontSize: '19px',
                fontWeight: '700',
                marginTop: '20px',
                cursor: 'pointer',
                color: 'white'
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '40px', fontSize: '16px', color: '#e0e7ff' }}>
            New here?{' '}
            <span
              onClick={() => navigate('/register')}
              style={{ color: '#facc15', cursor: 'pointer', fontWeight: '600' }}
            >
              Create account
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '20px',
  marginBottom: '20px',
  background: '#0f0f1f',
  border: '1px solid #334155',
  borderRadius: '16px',
  color: '#f8fafc',
  fontSize: '17px'
};