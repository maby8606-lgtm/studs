import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { idemConfig } from '../lib/idempotency';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const api = axios.create({
  baseURL: 'http://localhost:3001',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function RiderDashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [availableOrders, setAvailableOrders] = useState([]);
  const [myDeliveries, setMyDeliveries] = useState([]);
  const [earnings, setEarnings] = useState<any>(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [wdAmount, setWdAmount] = useState('');
  const [wdMomo, setWdMomo] = useState('');
  const [wdNetwork, setWdNetwork] = useState('MTN');
  const [wdMsg, setWdMsg] = useState('');
  const [wdBusy, setWdBusy] = useState(false);
  // Scheduled auto-payout destination (Go 2)
  const [payoutDest, setPayoutDest] = useState<any>(null);
  const [destMomo, setDestMomo] = useState('');
  const [destNetwork, setDestNetwork] = useState('MTN');
  const [destBusy, setDestBusy] = useState(false);
  const [destMsg, setDestMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [clockedIn, setClockedIn] = useState(false);
  const [riderLocation, setRiderLocation] = useState<[number, number]>([5.6404, -0.1874]); // Default UG Legon

  useEffect(() => {
    if (user.role !== 'RIDER') {
      navigate('/dashboard');
      return;
    }
    loadData();
    getLiveLocation();
  }, [user.role, navigate]);

  // Auto-refresh every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => loadData(), 8000);
    return () => clearInterval(interval);
  }, []);

  const getLiveLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          setRiderLocation([position.coords.latitude, position.coords.longitude]);
        },
        (err) => console.error("Location error", err)
      );
    }
  };

  const loadData = async () => {
    try {
      const [res1, res2, res3, res4, res5] = await Promise.all([
        api.get('/orders/available'),
        api.get('/orders/rider/my-deliveries'),
        api.get('/orders/rider/earnings'),
        api.get('/wallet/withdrawals'),
        api.get('/wallet/payout-destination').catch(() => ({ data: null })),
      ]);
      setAvailableOrders(res1.data || []);
      setMyDeliveries(res2.data || []);
      setEarnings(res3.data || null);
      setWithdrawals(res4.data || []);
      if (res5.data) {
        setPayoutDest(res5.data);
        if (res5.data.momoNumber) setDestMomo(res5.data.momoNumber);
        if (res5.data.network) setDestNetwork(res5.data.network);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleClockIn = async () => {
    try {
      if (!clockedIn) {
        await api.post('/orders/rider/clock-in');
        setClockedIn(true);
        alert('✅ Clocked In! Good deliveries!');
      } else {
        await api.post('/orders/rider/clock-out');
        setClockedIn(false);
        alert('✅ Clocked Out. Shift ended.');
      }
      loadData();
    } catch (err) {
      alert('Failed to update shift status');
    }
  };

  const acceptOrder = async (orderId: string) => {
    try {
      await api.post(`/orders/${orderId}/accept`);
      alert('Order accepted! 🚀');
      loadData();
    } catch (err) {
      alert('Failed to accept order');
    }
  };

  const markDelivered = async (orderId: string) => {
    const qrCode = window.prompt('Ask the student to show their QR code, then enter the code:');
    if (!qrCode) return;
    try {
      await api.post(`/orders/${orderId}/confirm`, { qrCodeScanned: qrCode.trim() });
      alert('Delivery completed! Great job!');
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to mark as delivered');
    }
  };

  const markPickedUp = async (orderId: string) => {
    try {
      await api.post(`/orders/${orderId}/picked-up`);
      alert('📦 Package picked up!');
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to mark picked up');
    }
  };

  const confirmWithSms = async (orderId: string) => {
    try {
      await api.post(`/orders/${orderId}/sms-code`);
    } catch { /* code may already be on its way; rider can still type it */ }
    const code = window.prompt('No QR? Ask the recipient for the 6-digit SMS code and enter it:');
    if (!code) return;
    try {
      await api.post(`/orders/${orderId}/confirm-sms`, { code: code.trim() });
      alert('Delivery completed via SMS code! Great job!');
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Invalid SMS code');
    }
  };

  const savePayoutDestination = async () => {
    if (destBusy) return;
    setDestBusy(true);
    setDestMsg('');
    try {
      const res = await api.patch('/wallet/payout-destination', {
        momoNumber: destMomo.replace(/\s+/g, ''), network: destNetwork,
      });
      setPayoutDest(res.data);
      setDestMsg('✅ Auto-payout destination saved. You are paid automatically every day at 6pm when your balance reaches the threshold.');
    } catch (err: any) {
      setDestMsg(err?.response?.data?.message || 'Could not save destination');
    } finally { setDestBusy(false); }
  };

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const requestWithdrawal = async () => {
    setWdMsg('');
    const amount = parseFloat(wdAmount);
    if (!amount || amount <= 0) { setWdMsg('Enter a valid amount.'); return; }
    if (!/^[0-9]{10}$/.test(wdMomo.replace(/\s+/g, ''))) { setWdMsg('MoMo number must be 10 digits.'); return; }
    setWdBusy(true);
    try {
      await api.post('/wallet/withdraw', { amount, momoNumber: wdMomo.replace(/\s+/g, ''), network: wdNetwork }, idemConfig());
      setWdMsg('✅ Withdrawal requested. It will be sent after admin approval.');
      setWdAmount('');
      loadData();
    } catch (err: any) {
      setWdMsg(err?.response?.data?.message || 'Withdrawal failed.');
    } finally {
      setWdBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc' }}>
      <nav style={{
        background: 'rgba(5, 6, 15, 0.97)',
        backdropFilter: 'blur(16px)',
        padding: '14px clamp(16px, 4vw, 40px)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(244, 114, 182, 0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ fontSize: '32px', fontWeight: '900', background: 'linear-gradient(90deg, #f472b6, #fb923c)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
          STUDS Rider
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <button
            onClick={toggleClockIn}
            style={{
              padding: '12px 28px',
              background: clockedIn ? '#ef4444' : '#f472b6',
              border: 'none',
              borderRadius: '999px',
              fontWeight: '700',
              color: 'white'
            }}
          >
            {clockedIn ? 'Clock Out' : 'Clock In'}
          </button>
          <button onClick={logout} style={{ padding: '12px 28px', background: '#ef4444', border: 'none', borderRadius: '999px', color: 'white', fontWeight: '600' }}>
            Logout
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(28px, 6vw, 60px) clamp(16px, 4vw, 40px)' }}>
        <div style={{ marginBottom: '60px' }}>
          <h1 style={{ fontSize: 'clamp(30px, 7vw, 52px)', fontWeight: '800' }}>Rider Hub</h1>
          <p style={{ color: '#f472b6', fontSize: '24px' }}>Live Tracking • {user.name}</p>
        </div>

        {/* Live Map */}
        <div style={{ height: '500px', borderRadius: '24px', overflow: 'hidden', marginBottom: '60px', border: '1px solid #334155' }}>
          <MapContainer center={riderLocation} zoom={15} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={riderLocation}>
              <Popup>You are here</Popup>
            </Marker>
          </MapContainer>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: '40px' }}>
          {/* Available Orders */}
          <div>
            <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#f472b6' }}>🚀 Available Orders</h2>
            {loading ? <p>Loading...</p> : availableOrders.length === 0 ? (
              <div style={{ background: '#1a1a2e', padding: '80px', borderRadius: '28px', textAlign: 'center' }}>
                <p style={{ fontSize: '22px' }}>No orders available right now</p>
              </div>
            ) : (
              availableOrders.map((order: any) => (
                <div key={order.id} style={{ background: '#1a1a2e', padding: '32px', borderRadius: '28px', marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                    <strong style={{ fontSize: '20px' }}>Order #{order.id?.slice(0,8)}</strong>
                    <span style={{ color: '#f472b6', fontSize: '22px', fontWeight: '700' }}>GHS {order.total || order.productTotal}</span>
                  </div>
                  <p><strong>Pickup:</strong> {order.pickupLocation || 'Main Canteen'}</p>
                  <p><strong>Dropoff:</strong> {order.deliveryLocation}</p>
                  <button
                    onClick={() => acceptOrder(order.id)}
                    style={{
                      marginTop: '24px',
                      width: '100%',
                      padding: '20px',
                      background: '#f472b6',
                      border: 'none',
                      borderRadius: '999px',
                      fontSize: '18px',
                      fontWeight: '700',
                      color: 'white'
                    }}
                  >
                    Accept Delivery
                  </button>
                </div>
              ))
            )}
          </div>

          {/* My Active Deliveries */}
          <div>
            <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#f472b6' }}>📍 My Active Deliveries</h2>
            {myDeliveries.length === 0 ? (
              <div style={{ background: '#1a1a2e', padding: '80px', borderRadius: '28px', textAlign: 'center' }}>
                <p style={{ fontSize: '22px' }}>No active deliveries</p>
              </div>
            ) : (
              myDeliveries.map((order: any) => (
                <div key={order.id} style={{ background: '#1a1a2e', padding: '32px', borderRadius: '28px', marginBottom: '24px' }}>
                  <p style={{ fontSize: '20px', fontWeight: '700' }}>{order.orderType === 'P2P' ? '📦' : '🧾'} Order #{order.id?.slice(0,8)}</p>
                  <p>Status: <strong style={{ color: '#fbbf24' }}>{order.status}</strong></p>
                  {order.pickupLocation && <p style={{ color: '#94a3b8', fontSize: '14px' }}>Pickup: {order.pickupLocation}{order.itemDescription ? ` · ${order.itemDescription}` : ''}</p>}
                  {order.status === 'ASSIGNED' && order.orderType === 'P2P' ? (
                    <button
                      onClick={() => markPickedUp(order.id)}
                      style={{
                        marginTop: '24px',
                        width: '100%',
                        padding: '20px',
                        background: '#38bdf8',
                        border: 'none',
                        borderRadius: '999px',
                        fontSize: '18px',
                        fontWeight: '700',
                        color: '#05060f'
                      }}
                    >
                      Mark Picked Up
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => markDelivered(order.id)}
                        style={{
                          marginTop: '24px',
                          width: '100%',
                          padding: '20px',
                          background: '#f472b6',
                          border: 'none',
                          borderRadius: '999px',
                          fontSize: '18px',
                          fontWeight: '700',
                          color: 'white'
                        }}
                      >
                        Mark as Delivered (QR)
                      </button>
                      <button
                        onClick={() => confirmWithSms(order.id)}
                        style={{
                          marginTop: '12px',
                          width: '100%',
                          padding: '18px',
                          background: '#1e293b',
                          border: '1px solid #38bdf8',
                          borderRadius: '999px',
                          fontSize: '16px',
                          fontWeight: '700',
                          color: '#38bdf8'
                        }}
                      >
                        Confirm with SMS Code
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Earnings & Withdrawal */}
        <div style={{ marginTop: '60px' }}>
          <h2 style={{ fontSize: '32px', marginBottom: '30px', color: '#f472b6' }}>💰 My Earnings</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: '24px', marginBottom: '32px' }}>
            {[
              ['Total Earned', `GHS ${earnings?.totalEarnedGHS ?? '0.00'}`],
              ['Deliveries', earnings?.completedDeliveries ?? 0],
              ['Wallet Balance', `GHS ${earnings?.walletBalanceGHS ?? '0.00'}`],
              ['Available to Withdraw', `GHS ${earnings?.availableToWithdrawGHS ?? '0.00'}`],
            ].map(([label, val]) => (
              <div key={label as string} style={{ background: '#1a1a2e', padding: '28px', borderRadius: '24px', textAlign: 'center' }}>
                <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '8px' }}>{label}</p>
                <p style={{ fontSize: '28px', fontWeight: '800', color: '#10b981' }}>{val}</p>
              </div>
            ))}
          </div>

          <div style={{ background: '#1a1a2e', padding: '32px', borderRadius: '28px', marginBottom: '32px' }}>
            <h3 style={{ fontSize: '22px', marginBottom: '20px' }}>Withdraw to MoMo</h3>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <input type="number" min="0" step="0.01" placeholder="Amount (GHS)" value={wdAmount}
                onChange={(e) => setWdAmount(e.target.value)}
                style={{ flex: '1 1 160px', padding: '16px', borderRadius: '14px', border: '1px solid #334155', background: '#0f0f1f', color: '#f8fafc', fontSize: '16px' }} />
              <input type="text" placeholder="MoMo number (10 digits)" value={wdMomo}
                onChange={(e) => setWdMomo(e.target.value)}
                style={{ flex: '1 1 200px', padding: '16px', borderRadius: '14px', border: '1px solid #334155', background: '#0f0f1f', color: '#f8fafc', fontSize: '16px' }} />
              <select value={wdNetwork} onChange={(e) => setWdNetwork(e.target.value)}
                style={{ padding: '16px', borderRadius: '14px', border: '1px solid #334155', background: '#0f0f1f', color: '#f8fafc', fontSize: '16px' }}>
                <option value="MTN">MTN</option>
                <option value="VODAFONE">Telecel</option>
                <option value="AIRTEL_TIGO">AirtelTigo</option>
              </select>
              <button onClick={requestWithdrawal} disabled={wdBusy}
                style={{ padding: '16px 36px', background: 'linear-gradient(90deg, #10b981, #34d399)', border: 'none', borderRadius: '999px', fontWeight: '700', fontSize: '16px', color: 'white', opacity: wdBusy ? 0.6 : 1 }}>
                {wdBusy ? 'Requesting…' : 'Request Withdrawal'}
              </button>
            </div>
            {wdMsg && <p style={{ marginTop: '16px', color: '#fbbf24' }}>{wdMsg}</p>}
          </div>

          <div style={{ background: '#1a1a2e', padding: '32px', borderRadius: '28px', marginBottom: '32px', border: '1px solid rgba(16,185,129,0.25)' }}>
            <h3 style={{ fontSize: '22px', marginBottom: '12px' }}>⚡ Scheduled Auto-Payout</h3>
            <p style={{ color: '#94a3b8', marginBottom: '20px' }}>
              {payoutDest?.autoPayoutEnabled
                ? `Automatic every day at 6pm when your available balance reaches GHS ${payoutDest?.thresholdGHS ?? '…'}. Save your MoMo below to opt in.`
                : 'Auto-payouts are currently disabled by the platform.'}
            </p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <input type="text" placeholder="MoMo number (10 digits)" value={destMomo}
                onChange={(e) => setDestMomo(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                style={{ flex: '1 1 200px', padding: '16px', borderRadius: '14px', border: '1px solid #334155', background: '#0f0f1f', color: '#f8fafc', fontSize: '16px' }} />
              <select value={destNetwork} onChange={(e) => setDestNetwork(e.target.value)}
                style={{ padding: '16px', borderRadius: '14px', border: '1px solid #334155', background: '#0f0f1f', color: '#f8fafc', fontSize: '16px' }}>
                <option value="MTN">MTN</option>
                <option value="VODAFONE">Telecel</option>
                <option value="AIRTEL_TIGO">AirtelTigo</option>
              </select>
              <button onClick={savePayoutDestination} disabled={destBusy}
                style={{ padding: '16px 36px', background: 'linear-gradient(90deg, #10b981, #34d399)', border: 'none', borderRadius: '999px', fontWeight: '700', fontSize: '16px', color: 'white', opacity: destBusy ? 0.6 : 1 }}>
                {destBusy ? 'Saving…' : 'Save Destination'}
              </button>
            </div>
            {destMsg && <p style={{ marginTop: '16px', color: '#fbbf24' }}>{destMsg}</p>}
          </div>

          {withdrawals.length > 0 && (
            <div style={{ background: '#1a1a2e', padding: '32px', borderRadius: '28px' }}>
              <h3 style={{ fontSize: '22px', marginBottom: '20px' }}>Withdrawal History</h3>
              {(withdrawals as any[]).map((w) => (
                <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #334155' }}>
                  <span>GHS {w.amount} → {w.momoNumber}</span>
                  <span style={{ color: w.status === 'COMPLETED' ? '#10b981' : '#fbbf24', fontWeight: '600' }}>
                    {w.status}{w.providerReference ? ` · ref ${String(w.providerReference).slice(0, 12)}…` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}