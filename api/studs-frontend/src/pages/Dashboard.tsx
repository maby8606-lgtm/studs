import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

export default function Dashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) navigate('/login');
  }, [token, navigate]);

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ marginBottom: '100px' }}>
            <h1 style={{ fontSize: '62px', fontWeight: '900', letterSpacing: '-3px', lineHeight: '1.05' }}>
              Welcome back, {user.name?.split(' ')[0] || 'Student'}
            </h1>
            <p style={{ color: '#f472b6', fontSize: '26px', marginTop: '16px' }}>
              University of Ghana • Legon
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '40px' }}>
            {/* Quick Order */}
            <div style={{
              background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
              padding: '64px 52px',
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
              padding: '64px 52px',
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
              padding: '64px 52px',
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
          </div>
        </div>
      </div>
    </>
  );
}