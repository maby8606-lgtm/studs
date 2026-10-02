import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
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
      const [res1, res2] = await Promise.all([
        api.get('/orders/available'),
        api.get('/orders/rider/my-deliveries')
      ]);
      setAvailableOrders(res1.data || []);
      setMyDeliveries(res2.data || []);
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
    try {
      await api.post(`/orders/${orderId}/confirm`);
      alert('Delivery completed! Great job!');
      loadData();
    } catch (err) {
      alert('Failed to mark as delivered');
    }
  };

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc' }}>
      <nav style={{
        background: 'rgba(5, 6, 15, 0.97)',
        backdropFilter: 'blur(16px)',
        padding: '18px 40px',
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

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '60px 40px' }}>
        <div style={{ marginBottom: '60px' }}>
          <h1 style={{ fontSize: '52px', fontWeight: '800' }}>Rider Hub</h1>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
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
                  <p style={{ fontSize: '20px', fontWeight: '700' }}>Order #{order.id?.slice(0,8)}</p>
                  <p>Status: <strong style={{ color: '#fbbf24' }}>{order.status}</strong></p>
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
                    Mark as Delivered
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}