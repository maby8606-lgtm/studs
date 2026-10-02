import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

const api = axios.create({
  baseURL: 'http://localhost:3001',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    campusId: 'ug-legon'
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    setUser(storedUser);
    setFormData({
      name: storedUser.name || '',
      phone: storedUser.phone || '',
      campusId: storedUser.campusId || 'ug-legon'
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const updatedUser = { ...user, ...formData };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      alert('Profile updated successfully!');
      setEditing(false);
    } catch (err) {
      alert('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '80px 40px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '80px' }}>
            <h1 style={{ fontSize: '58px', fontWeight: '900', letterSpacing: '-2px' }}>Profile</h1>
            <p style={{ color: '#f472b6', fontSize: '22px' }}>Manage your account</p>
          </div>

          <div style={{ background: '#1a1a2e', padding: '70px', borderRadius: '36px', boxShadow: '0 25px 50px rgba(0,0,0,0.6)' }}>
            {/* Profile Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '40px', marginBottom: '60px' }}>
              <div style={{
                width: '140px',
                height: '140px',
                background: 'linear-gradient(145deg, #f472b6, #fb923c)',
                borderRadius: '9999px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '64px',
                color: 'white',
                boxShadow: '0 10px 30px rgba(244, 114, 182, 0.4)'
              }}>
                👤
              </div>
              <div>
                <h2 style={{ fontSize: '38px', margin: '0' }}>{user?.name}</h2>
                <p style={{ color: '#f472b6', fontSize: '22px', margin: '8px 0' }}>{user?.role}</p>
                <p style={{ color: '#94a3b8' }}>{user?.email}</p>
              </div>
            </div>

            {/* Form Fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '12px', color: '#e0e7ff' }}>Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  disabled={!editing}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '12px', color: '#e0e7ff' }}>Phone Number</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  disabled={!editing}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: '32px' }}>
              <label style={{ display: 'block', marginBottom: '12px', color: '#e0e7ff' }}>Campus</label>
              <select
                value={formData.campusId}
                onChange={(e) => setFormData({...formData, campusId: e.target.value})}
                disabled={!editing}
                style={inputStyle}
              >
                <option value="ug-legon">University of Ghana - Legon</option>
                <option value="upsa">University of Professional Studies</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '20px', marginTop: '60px' }}>
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  style={{ flex: 1, padding: '22px', background: '#f472b6', border: 'none', borderRadius: '9999px', fontWeight: '700', fontSize: '18px', color: 'white' }}
                >
                  Edit Profile
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    style={{ flex: 1, padding: '22px', background: '#10b981', border: 'none', borderRadius: '9999px', fontWeight: '700', fontSize: '18px' }}
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    style={{ flex: 1, padding: '22px', background: '#334155', border: 'none', borderRadius: '9999px', fontWeight: '700', fontSize: '18px' }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ marginTop: '60px', textAlign: 'center' }}>
            <button
              onClick={logout}
              style={{ padding: '18px 52px', background: '#ef4444', border: 'none', borderRadius: '9999px', color: 'white', fontWeight: '700', fontSize: '18px' }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const inputStyle = {
  width: '100%',
  padding: '22px',
  background: '#0f0f1f',
  border: '1px solid #334155',
  borderRadius: '20px',
  color: '#f8fafc',
  fontSize: '18px'
};