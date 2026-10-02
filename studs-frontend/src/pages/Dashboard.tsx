import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';

const api = axios.create({ baseURL: 'http://localhost:3001' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function Dashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const token = localStorage.getItem('token');
  const [waLink, setWaLink] = useState<string | null>(null);

  useEffect(() => {
    if (!token) navigate('/login');
  }, [token, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/whatsapp/deeplink');
        if (res.data?.configured) setWaLink(res.data.url);
      } catch { /* WhatsApp card stays hidden */ }
    })();
  }, []);

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: 'clamp(32px, 7vw, 80px) clamp(16px, 4vw, 40px)' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ marginBottom: '100px' }}>
            <h1 style={{ fontSize: 'clamp(36px, 8vw, 62px)', fontWeight: '900', letterSpacing: '-3px', lineHeight: '1.05' }}>
              Welcome back, {user.name?.split(' ')[0] || 'Student'}
            </h1>
            <p style={{ color: '#f472b6', fontSize: 'clamp(19px, 4vw, 26px)', marginTop: '16px' }}>
              University of Ghana • Legon
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(460px, 100%), 1fr))', gap: '40px' }}>
            {/* Quick Order */}
            <div style={{
              background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
              padding: 'clamp(28px, 6vw, 64px) clamp(20px, 5vw, 52px)',
              borderRadius: '36px',
              border: '1px solid rgba(244, 114, 182, 0.25)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
              transition: 'transform 0.4s'
            }}>
              <div style={{ fontSize: '82px', marginBottom: '32px' }}>🍔</div>
              <h3 style={{ fontSize: '36px', marginBottom: '24px' }}>Order Food Now</h3>
              <p style={{ color: '#e0e7ff', fontSize: '19px', lineHeight: '1.6' }}>
                Browse campus vendors and get your meal delivered in minutes.
              </p>
              <button
                onClick={() => navigate('/menu')}
                style={{
                  width: '100%',
                  marginTop: '60px',
                  padding: '28px',
                  background: 'linear-gradient(90deg, #f472b6, #fb923c)',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '20px',
                  fontWeight: '700',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Browse Menu
              </button>
            </div>

            {/* My Orders */}
            <div style={{
              background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
              padding: 'clamp(28px, 6vw, 64px) clamp(20px, 5vw, 52px)',
              borderRadius: '36px',
              border: '1px solid rgba(163, 230, 187, 0.2)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
              transition: 'transform 0.4s'
            }}>
              <div style={{ fontSize: '82px', marginBottom: '32px' }}>📦</div>
              <h3 style={{ fontSize: '36px', marginBottom: '24px' }}>Track Orders</h3>
              <p style={{ color: '#e0e7ff', fontSize: '19px', lineHeight: '1.6' }}>
                View your active orders and delivery status in real-time.
              </p>
              <button
                onClick={() => navigate('/orders')}
                style={{
                  width: '100%',
                  marginTop: '60px',
                  padding: '28px',
                  background: 'transparent',
                  border: '2px solid #a3e6bb',
                  color: '#a3e6bb',
                  borderRadius: '9999px',
                  fontSize: '20px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                View My Orders
              </button>
            </div>

            {/* Wallet */}
            <div style={{
              background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
              padding: 'clamp(28px, 6vw, 64px) clamp(20px, 5vw, 52px)',
              borderRadius: '36px',
              border: '1px solid rgba(251, 191, 36, 0.25)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
              transition: 'transform 0.4s'
            }}>
              <div style={{ fontSize: '82px', marginBottom: '32px' }}>💰</div>
              <h3 style={{ fontSize: '36px', marginBottom: '24px' }}>My Wallet</h3>
              <p style={{ color: '#e0e7ff', fontSize: '19px', lineHeight: '1.6' }}>
                Manage your balance and make fast payments.
              </p>
              <button
                onClick={() => navigate('/wallet')}
                style={{
                  width: '100%',
                  marginTop: '60px',
                  padding: '28px',
                  background: '#fbbf24',
                  color: '#1e2937',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '20px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Check Balance
              </button>
            </div>

            {/* WhatsApp ordering */}
            {waLink && (
              <div style={{
                background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
                padding: 'clamp(28px, 6vw, 64px) clamp(20px, 5vw, 52px)',
                borderRadius: '36px',
                border: '1px solid rgba(37, 211, 102, 0.25)',
                boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
                transition: 'transform 0.4s'
              }}>
                <div style={{ fontSize: '82px', marginBottom: '32px' }}>💬</div>
                <h3 style={{ fontSize: '36px', marginBottom: '24px' }}>Order on WhatsApp</h3>
                <p style={{ color: '#e0e7ff', fontSize: '19px', lineHeight: '1.6' }}>
                  No app needed — text MENU, pick items, and track delivery in chat.
                </p>
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    width: '100%',
                    marginTop: '60px',
                    padding: '28px',
                    background: '#25D366',
                    color: '#052e16',
                    border: 'none',
                    borderRadius: '9999px',
                    fontSize: '20px',
                    fontWeight: '700',
                    textDecoration: 'none'
                  }}
                >
                  Open WhatsApp Chat
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}