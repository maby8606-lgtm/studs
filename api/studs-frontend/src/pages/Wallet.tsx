import { useState, useEffect } from 'react';
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

export default function Wallet() {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [customAmount, setCustomAmount] = useState('');

  useEffect(() => {
    loadWallet();
  }, []);

  const loadWallet = async () => {
    try {
      const res = await api.get('/wallet');
      setBalance(res.data.balance || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addMoney = async (amount: number | string) => {
    const numAmount = parseFloat(amount.toString());
    if (!numAmount || numAmount <= 0) return alert("Please enter a valid amount");

    setAdding(true);
    try {
      await api.post('/wallet/add', { amount: numAmount });
      alert(`✅ GHS ${numAmount} added successfully!`);
      setCustomAmount('');
      loadWallet();
    } catch (err) {
      alert('Failed to add money');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '80px 40px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '58px', fontWeight: '900', letterSpacing: '-2px' }}>My Wallet</h1>
          <p style={{ color: '#f472b6', fontSize: '24px' }}>Manage your STUDS balance</p>

          <div style={{
            background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
            padding: '100px 60px',
            borderRadius: '40px',
            marginTop: '60px',
            textAlign: 'center',
            boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
            border: '1px solid rgba(244, 114, 182, 0.2)'
          }}>
            <p style={{ color: '#e0e7ff', marginBottom: '16px', fontSize: '22px' }}>Available Balance</p>
            <h2 style={{
              fontSize: '92px',
              fontWeight: '900',
              color: '#f472b6',
              margin: '0 0 20px 0',
              letterSpacing: '-3px'
            }}>
              GHS {balance.toFixed(2)}
            </h2>
          </div>

          <div style={{ marginTop: '80px' }}>
            <h3 style={{ marginBottom: '40px', fontSize: '32px' }}>Add Money</h3>

            {/* Custom Amount */}
            <div style={{ display: 'flex', gap: '20px', marginBottom: '60px' }}>
              <input
                type="number"
                placeholder="Enter amount (GHS)"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                style={{
                  flex: 1,
                  padding: '28px',
                  background: '#1a1a2e',
                  border: '1px solid #334155',
                  borderRadius: '9999px',
                  color: '#f8fafc',
                  fontSize: '22px'
                }}
              />
              <button
                onClick={() => addMoney(customAmount)}
                disabled={adding || !customAmount}
                style={{
                  padding: '28px 64px',
                  background: '#f472b6',
                  border: 'none',
                  borderRadius: '9999px',
                  fontWeight: '700',
                  fontSize: '20px',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>

            {/* Quick Top-ups */}
            <h4 style={{ marginBottom: '32px', color: '#e0e7ff' }}>Quick Top-up</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '20px' }}>
              {[20, 50, 100, 200, 500].map((amount) => (
                <button
                  key={amount}
                  onClick={() => addMoney(amount)}
                  disabled={adding}
                  style={{
                    padding: '32px',
                    background: '#1a1a2e',
                    border: '2px solid #f472b6',
                    borderRadius: '24px',
                    fontSize: '24px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    color: '#f8fafc'
                  }}
                >
                  GHS {amount}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}