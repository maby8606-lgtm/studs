import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { idemConfig, newIdemKey } from '../lib/idempotency';

const api = axios.create({ baseURL: 'http://localhost:3001' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function Menu() {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<any[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [deliveryLocation, setDeliveryLocation] = useState('Your Location');
  const [placing, setPlacing] = useState(false);
  // Delivery zones: the server prices the fee from the zone's distance band.
  const [zones, setZones] = useState<any[]>([]);
  const [zoneId, setZoneId] = useState<string>('');
  const [waLink, setWaLink] = useState<string | null>(null);
  // One idempotency key per checkout attempt: a double-tap (or a retry on
  // flaky network) replays the same order instead of debiting twice.
  const checkoutKey = useRef<string>(newIdemKey());

  useEffect(() => {
    loadMenu();
    (async () => {
      try {
        const res = await api.get('/orders/delivery-zones?campusId=ug-legon');
        setZones(res.data.zones || []);
        if (res.data.zones?.length) setZoneId(res.data.zones[0].id);
      } catch { /* zone pricing falls back to legacy flat fee */ }
      try {
        const dl = await api.get('/whatsapp/deeplink');
        if (dl.data?.configured) setWaLink(dl.data.url);
      } catch { /* WhatsApp button stays hidden */ }
    })();
  }, []);

  const loadMenu = async () => {
    try {
      const res = await api.get('/menu-items');
      setMenuItems(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (item: any) => {
    setCart([...cart, item]);
  };

  const removeFromCart = (index: number) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = `Lat: ${position.coords.latitude.toFixed(4)}, Lng: ${position.coords.longitude.toFixed(4)}`;
          setDeliveryLocation(loc);
          alert('📍 Location captured! Riders will see this.');
        },
        () => alert('Unable to get location. Please allow access in browser.')
      );
    } else {
      alert('Geolocation not supported by your browser.');
    }
  };

  const placeOrder = async () => {
    if (cart.length === 0) return alert('Cart is empty');
    if (placing) return;
    setPlacing(true);
    try {
      const orderData = {
        vendorId: cart[0]?.vendorId || 'default',
        campusId: 'ug-legon',
        pickupLocation: 'Main Canteen Area',
        deliveryLocation: deliveryLocation,
        menuItemIds: cart.map(i => i.id),
        // The fee is priced server-side from the zone; never set client-side.
        deliveryZone: zoneId || undefined,
      };
      const res = await api.post('/orders', orderData, idemConfig(checkoutKey.current));
      const fee = res.data.deliveryFeeGHS;
      alert(`✅ Order Placed Successfully!\nOrder ID: ${res.data.orderId}\nDelivery: GHS ${fee}${res.data.deliveryFeeWaived ? ' (waived — STUDS Plus)' : ''}`);
      setCart([]);
      setShowCart(false);
      checkoutKey.current = newIdemKey();
    } catch (err: any) {
      console.error(err);
      alert(err?.response?.data?.message || '❌ Failed to place order');
    } finally {
      setPlacing(false);
    }
  };

  const totalPrice = cart.reduce((sum, item) => sum + Number(item.price), 0);
  const zoneFee = Number(zones.find(z => z.id === zoneId)?.feeGHS ?? 0);

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#05060f', color: '#f8fafc', padding: 'clamp(28px, 6vw, 60px) clamp(16px, 4vw, 40px)' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', marginBottom: 'clamp(32px, 6vw, 60px)' }}>
            <div>
              <h1 style={{ fontSize: 'clamp(32px, 7vw, 56px)', fontWeight: '800', letterSpacing: '-1.5px' }}>Campus Menu</h1>
              <p style={{ color: '#f472b6', fontSize: '20px' }}>Fresh meals from your favorite vendors</p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: '18px 28px',
                    background: '#25D366',
                    color: '#052e16',
                    borderRadius: '9999px',
                    fontSize: '16px',
                    fontWeight: '700',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  💬 Order on WhatsApp
                </a>
              )}
              <button
                onClick={() => setShowCart(true)}
                style={{
                  padding: '18px 36px',
                  background: '#f472b6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '18px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                🛒 Cart ({cart.length})
              </button>
            </div>
          </div>

          {loading ? (
            <p style={{ textAlign: 'center', fontSize: '22px', color: '#e0e7ff' }}>Loading delicious food...</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: '40px' }}>
              {menuItems.map((item: any) => (
                <div key={item.id} style={{
                  background: 'linear-gradient(145deg, #1a1a2e, #0f0f1f)',
                  borderRadius: '32px',
                  overflow: 'hidden',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                  transition: 'transform 0.3s, box-shadow 0.3s'
                }}>
                  {item.image && (
                    <img
                      src={`http://localhost:3001${item.image}`}
                      alt={item.name}
                      style={{ width: '100%', height: '260px', objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ padding: '32px' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '26px' }}>{item.name}</h3>
                    <p style={{ color: '#e0e7ff', marginBottom: '24px', lineHeight: '1.6' }}>{item.description}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '30px', fontWeight: '700', color: '#f472b6' }}>GHS {item.price}</span>
                      <button
                        onClick={() => addToCart(item)}
                        style={{
                          padding: '16px 36px',
                          background: '#f472b6',
                          border: 'none',
                          borderRadius: '9999px',
                          fontWeight: '700',
                          fontSize: '17px',
                          color: 'white'
                        }}
                      >
                        Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modern Cart Sidebar */}
      {showCart && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 'min(460px, 100vw)',
          height: '100dvh',
          background: '#05060f',
          boxShadow: '-20px 0 40px rgba(0,0,0,0.7)',
          zIndex: 2000,
          overflowY: 'auto',
          color: '#f8fafc'
        }}>
          <div style={{ padding: '40px' }}>
            <h2 style={{ marginBottom: '40px', fontSize: '32px' }}>Your Cart ({cart.length})</h2>

            {cart.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#e0e7ff', fontSize: '20px' }}>Your cart is empty</p>
            ) : (
              <>
                {cart.map((item, index) => (
                  <div key={index} style={{
                    background: '#1a1a2e',
                    padding: '20px',
                    borderRadius: '20px',
                    marginBottom: '20px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h4>{item.name}</h4>
                        <p style={{ color: '#f472b6' }}>GHS {item.price}</p>
                      </div>
                      <button onClick={() => removeFromCart(index)} style={{ color: '#ef4444', fontWeight: '600' }}>Remove</button>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: '50px', padding: '28px', background: '#0f0f1f', borderRadius: '24px' }}>
                  {zones.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '14px', color: '#e0e7ff', marginBottom: '8px' }}>
                        📦 Delivery zone (fee follows distance)
                      </label>
                      <select
                        value={zoneId}
                        onChange={(e) => setZoneId(e.target.value)}
                        style={{ width: '100%', padding: '14px', borderRadius: '12px', background: '#1a1a2e', color: '#f8fafc', border: '1px solid #475569' }}
                      >
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>{z.name} — GHS {z.feeGHS}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p style={{ margin: '0 0 8px 0', color: '#e0e7ff' }}>Items: GHS {totalPrice.toFixed(2)}</p>
                  {zoneId && <p style={{ margin: '0 0 8px 0', color: '#e0e7ff' }}>Delivery: GHS {zoneFee.toFixed(2)}{' '}<span style={{ color: '#94a3b8', fontSize: '13px' }}>(waived with STUDS Plus)</span></p>}
                  <h3 style={{ marginBottom: '20px' }}>Total: GHS {(totalPrice + zoneFee).toFixed(2)}</h3>

                  <button
                    onClick={getCurrentLocation}
                    style={{
                      width: '100%',
                      padding: '16px',
                      background: '#f472b6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '9999px',
                      marginBottom: '16px'
                    }}
                  >
                    📍 Use My Current Location
                  </button>

                  <button
                    onClick={placeOrder}
                    disabled={placing}
                    style={{
                      width: '100%',
                      padding: '22px',
                      background: '#fb923c',
                      color: 'white',
                      border: 'none',
                      borderRadius: '9999px',
                      fontSize: '19px',
                      fontWeight: '700',
                      opacity: placing ? 0.6 : 1
                    }}
                  >
                    {placing ? 'Placing…' : 'Place Order'}
                  </button>
                </div>
              </>
            )}

            <button
              onClick={() => setShowCart(false)}
              style={{ marginTop: '40px', width: '100%', padding: '16px', background: 'transparent', border: '1px solid #475569', borderRadius: '9999px', color: '#e0e7ff' }}
            >
              Close Cart
            </button>
          </div>
        </div>
      )}
    </>
  );
}