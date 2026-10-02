import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LogIn } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await axios.post('http://localhost:3001/auth/login', { email, password });
      localStorage.setItem('token', res.data.access_token);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0f1c, #1a2338)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', color: 'white' }}>
      <div style={{ width: '100%', maxWidth: '460px' }}>
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <div style={{ fontSize: '110px', fontWeight: '900', background: 'linear-gradient(90deg, #10b981, #34d399)', WebkitBackgroundClip: 'text', color: 'transparent' }}>S</div>
          <h1 style={{ fontSize: '56px', fontWeight: '800' }}>STUDS</h1>
          <p style={{ color: '#94a3b8' }}>Campus Delivery • Legon</p>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.95)', padding: '52px 48px', borderRadius: '32px', boxShadow: '0 30px 70px -15px rgba(0,0,0,0.7)' }}>
          {error && <p style={{ color: '#f87171', textAlign: 'center', marginBottom: '24px' }}>{error}</p>}

          <form onSubmit={handleSubmit}>
            <input type="email" placeholder="yourname@ug.edu.gh" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: '20px', marginBottom: '18px', background: '#1e2937', border: '1px solid #475569', borderRadius: '16px', color: 'white', fontSize: '17px' }} required />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', padding: '20px', marginBottom: '32px', background: '#1e2937', border: '1px solid #475569', borderRadius: '16px', color: 'white', fontSize: '17px' }} required />
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '20px', background: '#10b981', border: 'none', borderRadius: '16px', fontSize: '19px', fontWeight: '700', cursor: 'pointer' }}>
              {loading ? 'Signing in...' : 'Sign In'} <LogIn style={{ marginLeft: '8px' }} />
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '28px', color: '#94a3b8' }}>
            New here? <span onClick={() => navigate('/register')} style={{ color: '#34d399', cursor: 'pointer', fontWeight: '600' }}>Create account</span>
          </p>
        </div>
      </div>
    </div>
  );
}
