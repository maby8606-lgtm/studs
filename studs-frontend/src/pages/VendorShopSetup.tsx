import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

const api = axios.create({ baseURL: 'http://localhost:3001' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function VendorShopSetup() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [shopData, setShopData] = useState({
    name: '',
    description: '',
    phone: '',
    location: '',
    logo: null as File | null
  });
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user.role !== 'VENDOR') navigate('/vendor/dashboard');
    // TODO: Load existing shop data later
  }, [user.role, navigate]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setShopData({ ...shopData, logo: file });
      setPreview(URL.createObjectURL(file));
    }
  };

  const saveShop = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', shopData.name);
      formData.append('description', shopData.description);
      formData.append('phone', shopData.phone);
      formData.append('location', shopData.location);
      if (shopData.logo) formData.append('logo', shopData.logo);

      // TODO: Connect to real endpoint later
      await api.post('/vendor/shop', formData);
      alert('Shop setup completed successfully!');
    } catch (err) {
      alert('Failed to save shop info');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '80px 40px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h1 style={{ fontSize: 'clamp(34px, 8vw, 58px)', fontWeight: '900', letterSpacing: '-2px' }}>Shop Setup</h1>
          <p style={{ color: '#f472b6', fontSize: '22px' }}>Tell students about your business</p>

          <div style={{ 
            background: '#1a1a2e', 
            padding: '70px', 
            borderRadius: '36px', 
            marginTop: '60px',
            boxShadow: '0 25px 50px rgba(0,0,0,0.6)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '50px' }}>
              {preview ? (
                <img src={preview} alt="logo" style={{ width: '180px', height: '180px', borderRadius: '9999px', objectFit: 'cover', border: '4px solid #f472b6' }} />
              ) : (
                <div style={{ width: '180px', height: '180px', background: '#0f0f1f', borderRadius: '9999px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '70px', color: '#f472b6' }}>
                  🏪
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleLogoChange} style={{ marginTop: '24px' }} />
            </div>

            <input
              type="text"
              placeholder="Shop Name"
              value={shopData.name}
              onChange={(e) => setShopData({...shopData, name: e.target.value})}
              style={inputStyle}
            />

            <textarea
              placeholder="Shop Description (What do you sell?)"
              value={shopData.description}
              onChange={(e) => setShopData({...shopData, description: e.target.value})}
              style={{ ...inputStyle, minHeight: '140px' }}
            />

            <input
              type="tel"
              placeholder="Phone Number"
              value={shopData.phone}
              onChange={(e) => setShopData({...shopData, phone: e.target.value})}
              style={inputStyle}
            />

            <input
              type="text"
              placeholder="Location / Canteen Area"
              value={shopData.location}
              onChange={(e) => setShopData({...shopData, location: e.target.value})}
              style={inputStyle}
            />

            <button
              onClick={saveShop}
              disabled={loading}
              style={{
                width: '100%',
                padding: '24px',
                background: 'linear-gradient(90deg, #f472b6, #fb923c)',
                border: 'none',
                borderRadius: '9999px',
                fontSize: '19px',
                fontWeight: '700',
                marginTop: '40px',
                color: 'white'
              }}
            >
              {loading ? 'Saving Shop...' : 'Save Shop Information'}
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
  marginBottom: '28px',
  background: '#0f0f1f',
  border: '1px solid #334155',
  borderRadius: '20px',
  color: '#f8fafc',
  fontSize: '18px'
};