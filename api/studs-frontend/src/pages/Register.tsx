import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Register() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'STUDENT'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await axios.post('http://localhost:3001/auth/register', {
        ...formData,
        phone: '0551234567', // temporary
        campusId: 'ug-legon'
      });
      alert('✅ Account created successfully! Please login.');
      navigate('/login');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed');
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
            fontSize: '140px',
            fontWeight: '900',
            background: 'linear-gradient(90deg, #f472b6, #fb923c, #facc15)',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            lineHeight: '0.8',
            marginBottom: '-30px',
            letterSpacing: '-8px'
          }}>S</div>
          <h1 style={{ fontSize: '58px', fontWeight: '900', letterSpacing: '-3px', margin: '0' }}>STUDS</h1>
          <p style={{ color: '#e0e7ff', fontSize: '20px', marginTop: '8px' }}>Campus Delivery</p>
        </div>

        <div style={{
          background: 'rgba(26, 26, 46, 0.95)',
          padding: '60px 52px',
          borderRadius: '32px',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(244, 114, 182, 0.15)'
        }}>
          <h2 style={{ textAlign: 'center', marginBottom: '40px', fontSize: '32px' }}>Create Account</h2>

          {error && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '24px' }}>{error}</p>}

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Full Name"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              style={inputStyle}
              required
            />

            <select
              value={formData.role}
              onChange={(e) => setFormData({...formData, role: e.target.value})}
              style={inputStyle}
            >
              <option value="STUDENT">Student</option>
              <option value="RIDER">Rider (Delivery Partner)</option>
              <option value="VENDOR">Vendor (Food Seller)</option>
            </select>

            <input
              type="email"
              placeholder="yourname@ug.edu.gh"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              style={inputStyle}
              required
            />

            <input
              type="password"
              placeholder="Create Password"
              value={formData.password}
              onChange={(e) => setFormData({...formData, password: e.target.value})}
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
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '40px', fontSize: '16px', color: '#e0e7ff' }}>
            Already have an account?{' '}
            <span
              onClick={() => navigate('/login')}
              style={{ color: '#facc15', cursor: 'pointer', fontWeight: '600' }}
            >
              Sign in
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