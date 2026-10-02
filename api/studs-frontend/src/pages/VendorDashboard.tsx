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

export default function VendorDashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [menuItems, setMenuItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [newItem, setNewItem] = useState({
    name: '',
    price: '',
    description: '',
    image: null as File | null
  });
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user.role !== 'VENDOR') navigate('/dashboard');
    else loadMenu();
  }, [user.role, navigate]);

  const loadMenu = async () => {
    try {
      const res = await api.get('/menu-items/my-items');
      setMenuItems(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewItem({ ...newItem, image: file });
      setPreview(URL.createObjectURL(file));
    }
  };

  const openEdit = (item: any) => {
    setEditingItem(item);
    setNewItem({
      name: item.name,
      price: item.price.toString(),
      description: item.description || '',
      image: null
    });
    setPreview(item.image ? `http://localhost:3001${item.image}` : '');
    setShowForm(true);
  };

  const addOrUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name || !newItem.price) return alert("Name and price required");

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', newItem.name);
      formData.append('price', newItem.price);
      formData.append('description', newItem.description || '');

      if (newItem.image) formData.append('image', newItem.image);

      if (editingItem) {
        await api.put(`/menu-items/${editingItem.id}`, formData);
        alert('Item updated successfully!');
      } else {
        await api.post('/menu-items', formData);
        alert('Item added successfully!');
      }

      resetForm();
      loadMenu();
    } catch (err) {
      console.error(err);
      alert('Failed. Check console.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setNewItem({ name: '', price: '', description: '', image: null });
    setPreview('');
    setShowForm(false);
    setEditingItem(null);
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return;
    try {
      await api.delete(`/menu-items/${id}`);
      alert('Item deleted!');
      loadMenu();
    } catch (err) {
      alert('Failed to delete');
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
        <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '60px' }}>
            <div>
              <h1 style={{ fontSize: '56px', fontWeight: '800', letterSpacing: '-1.5px' }}>My Shop</h1>
              <p style={{ color: '#f472b6', fontSize: '22px' }}>Welcome back, {user.name}</p>
            </div>
            <button
              onClick={() => { resetForm(); setShowForm(!showForm); }}
              style={{
                padding: '18px 40px',
                background: 'linear-gradient(90deg, #f472b6, #fb923c)',
                border: 'none',
                borderRadius: '9999px',
                fontWeight: '700',
                fontSize: '18px',
                color: 'white'
              }}
            >
              {showForm ? 'Cancel' : '+ Add New Item'}
            </button>
          </div>

          {showForm && (
            <div style={{
              background: '#1a1a2e',
              padding: '48px',
              borderRadius: '32px',
              marginBottom: '60px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}>
              <h3 style={{ marginBottom: '32px', fontSize: '28px' }}>{editingItem ? 'Edit Item' : 'Add New Menu Item'}</h3>
              <form onSubmit={addOrUpdateItem}>
                <input type="file" accept="image/*" onChange={handleImageChange} style={{ marginBottom: '24px' }} />
                {preview && <img src={preview} alt="preview" style={{ width: '240px', borderRadius: '20px', marginBottom: '24px' }} />}

                <input
                  type="text"
                  placeholder="Item Name"
                  value={newItem.name}
                  onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                  required
                  style={inputStyle}
                />
                <input
                  type="number"
                  placeholder="Price (GHS)"
                  value={newItem.price}
                  onChange={(e) => setNewItem({...newItem, price: e.target.value})}
                  required
                  style={inputStyle}
                />
                <textarea
                  placeholder="Description"
                  value={newItem.description}
                  onChange={(e) => setNewItem({...newItem, description: e.target.value})}
                  style={{ ...inputStyle, minHeight: '120px' }}
                />

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '20px 52px',
                    background: 'linear-gradient(90deg, #f472b6, #fb923c)',
                    border: 'none',
                    borderRadius: '9999px',
                    fontWeight: '700',
                    fontSize: '18px',
                    color: 'white'
                  }}
                >
                  {loading ? 'Saving...' : editingItem ? 'Update Item' : 'Add to Menu'}
                </button>
              </form>
            </div>
          )}

          <h2 style={{ marginBottom: '40px', fontSize: '32px' }}>Current Menu Items ({menuItems.length})</h2>

          {menuItems.length === 0 ? (
            <div style={{ background: '#1a1a2e', padding: '80px', borderRadius: '32px', textAlign: 'center' }}>
              <p style={{ fontSize: '22px' }}>No items yet. Add some above.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '32px' }}>
              {menuItems.map((item: any) => (
                <div key={item.id} style={{
                  background: '#1a1a2e',
                  padding: '28px',
                  borderRadius: '28px',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                  {item.image && <img src={`http://localhost:3001${item.image}`} style={{ width: '100%', height: '220px', objectFit: 'cover', borderRadius: '20px', marginBottom: '24px' }} />}
                  <h4 style={{ marginBottom: '12px', fontSize: '24px' }}>{item.name}</h4>
                  <p style={{ color: '#e0e7ff', marginBottom: '20px', lineHeight: '1.5' }}>{item.description}</p>
                  <p style={{ color: '#f472b6', fontSize: '28px', fontWeight: '700' }}>GHS {item.price}</p>

                  <div style={{ marginTop: '28px', display: 'flex', gap: '16px' }}>
                    <button onClick={() => openEdit(item)} style={{ flex: 1, padding: '16px', background: '#fbbf24', color: 'black', border: 'none', borderRadius: '999px', fontWeight: '600' }}>Edit</button>
                    <button onClick={() => deleteItem(item.id)} style={{ flex: 1, padding: '16px', background: '#ef4444', border: 'none', borderRadius: '999px', fontWeight: '600' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const inputStyle = {
  width: '100%',
  padding: '20px',
  marginBottom: '24px',
  background: '#0f0f1f',
  border: '1px solid #334155',
  borderRadius: '16px',
  color: '#f8fafc',
  fontSize: '17px'
};