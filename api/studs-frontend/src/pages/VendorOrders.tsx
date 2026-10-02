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

export default function VendorOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'VENDOR') navigate('/vendor/dashboard');
    loadOrders();
  }, [navigate]);

  const loadOrders = async () => {
    try {
      const res = await api.get('/orders/vendor/my-orders');
      setOrders(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const markAsPickedUp = async (orderId: string) => {
    try {
      await api.post(`/orders/${orderId}/picked-up`);
      alert('Order marked as picked up!');
      loadOrders();
    } catch (err) {
      alert('Failed to update');
    }
  };

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: '60px 40px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '50px' }}>
            <h1 style={{ fontSize: '52px', fontWeight: '800' }}>Incoming Orders ({orders.length})</h1>
            <button onClick={loadOrders} style={{ padding: '14px 32px', background: '#1a1a2e', border: 'none', borderRadius: '999px', fontWeight: '600', color: '#f8fafc' }}>
              Refresh Orders
            </button>
          </div>

          {loading ? (
            <p style={{ textAlign: 'center', fontSize: '22px', color: '#e0e7ff' }}>Loading orders...</p>
          ) : orders.length === 0 ? (
            <div style={{ background: '#1a1a2e', padding: '120px', borderRadius: '32px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '28px' }}>No orders yet</h3>
              <p style={{ color: '#e0e7ff', marginTop: '16px' }}>New student orders will appear here</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '32px' }}>
              {orders.map((order: any) => (
                <div key={order.id} style={{
                  background: '#1a1a2e',
                  padding: '40px',
                  borderRadius: '32px',
                  borderLeft: '8px solid #f472b6',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ fontSize: '24px', fontWeight: '700' }}>Order #{order.id.slice(0,8)}</p>
                      <p style={{ color: '#e0e7ff', marginTop: '8px' }}>
                        Placed: {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '32px', fontWeight: '700', color: '#f472b6' }}>GHS {order.total}</p>
                      <p style={{ color: '#fbbf24', fontWeight: '600', marginTop: '8px' }}>{order.status}</p>
                    </div>
                  </div>

                  <div style={{ marginTop: '28px', padding: '20px', background: '#0f0f1f', borderRadius: '20px' }}>
                    <strong>Delivery to:</strong> {order.deliveryLocation || 'Student Location'}
                  </div>

                  <button
                    onClick={() => markAsPickedUp(order.id)}
                    style={{
                      marginTop: '32px',
                      padding: '18px 48px',
                      background: 'linear-gradient(90deg, #f472b6, #fb923c)',
                      border: 'none',
                      borderRadius: '9999px',
                      fontWeight: '700',
                      fontSize: '18px',
                      color: 'white'
                    }}
                  >
                    Mark as Picked Up
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}