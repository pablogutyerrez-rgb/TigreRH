/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  UserCheck,
  UserX,
  Mail,
  Shield,
  Search,
  Lock,
  X,
  Calendar,
  KeyRound
} from 'lucide-react';
import { User, UserArea, UserRole } from '../types';

interface UsuariosProps {
  users: User[];
  currentUser: User;
  onAddUser: (newUser: Omit<User, 'id' | 'fecha_creacion' | 'correo'> & { correo?: string }) => void | Promise<void>;
  onUpdateUser: (id: string, updatedUser: Partial<User>) => void | Promise<void>;
  onDeleteUser: (id: string) => void;
  onResetPassword: (user: User, newPassword: string) => void | Promise<void>;
}

const MIN_PASSWORD_LENGTH = 6;
const MULTI_AREA_ROLES: UserRole[] = ['Administrador', 'Analista', 'Coordinador', 'Sistemas'];

const AREA_OPTIONS: Array<{ id: UserArea; label: string; description: string }> = [
  { id: 'seleccion', label: 'Selección', description: 'Convocatorias, postulantes, seguimiento y asignación.' },
  { id: 'formacion', label: 'Formación', description: 'Capacitaciones, asistencia, altas y encuestas.' },
  { id: 'comercial', label: 'Gestión Comercial', description: 'Dashboard, ventas, postventa y gestión de datos.' },
  { id: 'administrador', label: 'Administrador', description: 'Usuarios, reportes exportables y auditoría.' },
];

const MODULE_OPTIONS: Record<UserArea, Array<{ id: string; label: string }>> = {
  seleccion: [
    { id: 'seleccion:dashboard', label: 'Dashboard de Selección' },
    { id: 'seleccion:convocatorias', label: 'Convocatorias' },
    { id: 'seleccion:postulantes', label: 'Postulantes' },
    { id: 'seleccion:seguimientos', label: 'Seguimientos' },
    { id: 'seleccion:agenda', label: 'Agenda y Citaciones' },
    { id: 'seleccion:evaluaciones', label: 'Entrevistas y Evaluaciones' },
    { id: 'seleccion:aptos', label: 'Aptos para Capacitación' },
    { id: 'seleccion:base', label: 'Base de Postulantes' },
    { id: 'seleccion:asignacion', label: 'Asignación a Capacitación' },
    { id: 'seleccion:historial', label: 'Historial de Selección' },
    { id: 'seleccion:automatizaciones', label: 'Automatizaciones' },
    { id: 'seleccion:catalogos', label: 'Catálogos' },
    { id: 'seleccion:configuracion', label: 'Configuración' },
    { id: 'seleccion:reportes', label: 'Reportes' },
    { id: 'seleccion:auditoria', label: 'Auditoría' },
  ],
  formacion: [
    { id: 'formacion:dashboard', label: 'Dashboard de Formación' },
    { id: 'formacion:capacitaciones', label: 'Registro de Capacitaciones' },
    { id: 'formacion:asistencia', label: 'Control de Asistencia' },
    { id: 'formacion:altas', label: 'Confirmación de Altas' },
    { id: 'formacion:reaperturas', label: 'Reaperturas' },
    { id: 'formacion:encuestas', label: 'Encuestas de Satisfacción' },
    { id: 'formacion:prospectos', label: 'Prospectos' },
    { id: 'formacion:variables', label: 'Medición de Variables' },
    { id: 'formacion:rotacion', label: 'Rotación' },
    { id: 'formacion:reportes', label: 'Reportes Exportables' },
  ],
  comercial: [
    { id: 'comercial:dashboard', label: 'Dashboard Comercial' },
    { id: 'comercial:ventas', label: 'Ventas' },
    { id: 'comercial:postventa', label: 'Postventa' },
    { id: 'comercial:datos', label: 'Gestión de Datos' },
  ],
  administrador: [
    { id: 'administrador:usuarios', label: 'Usuarios' },
    { id: 'administrador:reportes', label: 'Reportes Exportables' },
    { id: 'administrador:auditoria', label: 'Auditoría del Sistema' },
  ],
};

const defaultAreasByRole = (role: UserRole): UserArea[] => {
  if (role === 'Administrador') return ['seleccion', 'formacion', 'comercial', 'administrador'];
  if (role === 'Analista' || role === 'Coordinador' || role === 'Sistemas') return ['seleccion', 'formacion'];
  if (role === 'Reclutador') return ['seleccion'];
  return ['formacion'];
};

const defaultModulesForAreas = (areas: UserArea[]) =>
  areas.flatMap((area) => MODULE_OPTIONS[area].map((item) => item.id));

export default function Usuarios({ users, currentUser, onAddUser, onUpdateUser, onDeleteUser, onResetPassword }: UsuariosProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form states (Create/Edit)
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<UserRole>('Formador');
  const [estado, setEstado] = useState<'Activo' | 'Inactivo'>('Activo');
  const [areas, setAreas] = useState<UserArea[]>(defaultAreasByRole('Formador'));
  const [moduleAccess, setModuleAccess] = useState<string[]>(defaultModulesForAreas(defaultAreasByRole('Formador')));
  const [moduleViewOnly, setModuleViewOnly] = useState<string[]>([]);

  // Change Password Modal States
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Filter users
  const filteredUsers = users.filter(u => {
    return u.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.correo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.usuario.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.rol.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const isMainAdmin = (u: User) => {
    return u.usuario.toLowerCase() === 'alicia.cleque';
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setNombre('');
    setCorreo('');
    setUsuario('');
    setPassword('');
    setRol('Formador');
    setEstado('Activo');
    const nextAreas = defaultAreasByRole('Formador');
    setAreas(nextAreas);
    setModuleAccess(defaultModulesForAreas(nextAreas));
    setModuleViewOnly([]);
    setShowModal(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingId(user.id);
    setNombre(user.nombre);
    setCorreo(user.correo || '');
    setUsuario(user.usuario);
    setPassword(''); // Empty to keep existing password unless changed
    setRol(user.rol);
    setEstado(user.estado);
    const nextAreas = user.areas && user.areas.length > 0 ? user.areas : defaultAreasByRole(user.rol);
    setAreas(nextAreas);
    setModuleAccess(user.module_access && user.module_access.length > 0 ? user.module_access : defaultModulesForAreas(nextAreas));
    setModuleViewOnly(user.module_view_only || []);
    setShowModal(true);
  };

  const handleRoleChange = (nextRole: UserRole) => {
    setRol(nextRole);
    const nextAreas = defaultAreasByRole(nextRole);
    setAreas(nextAreas);
    setModuleAccess(defaultModulesForAreas(nextAreas));
    setModuleViewOnly([]);
  };

  const toggleArea = (area: UserArea) => {
    const allowsMultiple = MULTI_AREA_ROLES.includes(rol);
    const nextAreas = areas.includes(area)
      ? areas.filter((item) => item !== area)
      : allowsMultiple
        ? [...areas, area]
        : [area];
    const safeAreas = nextAreas.length > 0 ? nextAreas : [area];
    const allowedModuleIds = new Set(defaultModulesForAreas(safeAreas));
    setAreas(safeAreas);
    setModuleViewOnly((prev) => prev.filter((item) => allowedModuleIds.has(item)));
    setModuleAccess((prev) => {
      const kept = prev.filter((item) => allowedModuleIds.has(item));
      const defaultsForNewArea = MODULE_OPTIONS[area].map((item) => item.id);
      const next = [...new Set([...kept, ...defaultsForNewArea.filter((item) => safeAreas.includes(item.split(':')[0] as UserArea))])];
      return next.length > 0 ? next : defaultModulesForAreas(safeAreas);
    });
  };

  const toggleModule = (moduleId: string) => {
    setModuleViewOnly((prev) => prev.filter((item) => item !== moduleId));
    setModuleAccess((prev) =>
      prev.includes(moduleId)
        ? prev.filter((item) => item !== moduleId)
        : [...prev, moduleId],
    );
  };

  const handleOpenPasswordModal = (user: User) => {
    setPasswordUserId(user.id);
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !usuario.trim()) {
      alert('Por favor complete todos los campos obligatorios.');
      return;
    }
    if (areas.length === 0) {
      alert('Selecciona al menos un área de acceso.');
      return;
    }
    if (moduleAccess.length === 0) {
      alert('Selecciona al menos un apartado de acceso.');
      return;
    }

    try {
      setIsSaving(true);

      if (editingId) {
        await onUpdateUser(editingId, {
          nombre: nombre.trim(),
          correo: correo.trim(),
          usuario: usuario.trim(),
          rol,
          estado,
          areas,
          module_access: moduleAccess,
          module_view_only: moduleViewOnly.filter((item) => moduleAccess.includes(item)),
        });
        alert('Usuario actualizado correctamente.');
      } else {
        const trimmedPassword = password.trim();

        if (!trimmedPassword) {
          alert('Se requiere una contrasena temporal para el nuevo usuario.');
          return;
        }
        if (trimmedPassword.length < MIN_PASSWORD_LENGTH) {
          alert(`La contrasena temporal debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
          return;
        }
        await onAddUser({
          nombre: nombre.trim(),
          correo: correo.trim(),
          usuario: usuario.trim(),
          password: trimmedPassword,
          rol,
          estado,
          areas,
          module_access: moduleAccess,
          module_view_only: moduleViewOnly.filter((item) => moduleAccess.includes(item)),
        });
        alert('Usuario creado en Firebase Authentication y Firestore correctamente.');
      }

      setShowModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo guardar el usuario.');
    } finally {
      setIsSaving(false);
    }
  };
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) {
      alert('La nueva contraseña no puede estar vacía.');
      return;
    }
    if (newPassword.trim().length < MIN_PASSWORD_LENGTH) {
      alert(`La nueva contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('Las contraseñas no coinciden.');
      return;
    }

    if (passwordUserId) {
      const user = users.find(u => u.id === passwordUserId);
      if (!user) return;
      try {
        setIsSaving(true);
        await onResetPassword(user, newPassword.trim());
        setShowPasswordModal(false);
        setPasswordUserId(null);
      } catch (error) {
        console.error('Error resetting password:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleDeleteClick = (user: User) => {
    if (isMainAdmin(user)) {
      alert('El usuario administrador principal "Alicia.Cleque" está protegido y no puede ser eliminado.');
      return;
    }
    
    // Check if trying to delete own active admin account
    const activeAdmins = users.filter(
      u => u.rol === 'Administrador' && u.estado === 'Activo'
    );
    if (user.id === currentUser.id && activeAdmins.length <= 1) {
      alert('No puedes eliminar el único usuario administrador activo de la plataforma.');
      return;
    }

    setUserToDelete(user);
  };

  const handleToggleStatus = (user: User) => {
    if (isMainAdmin(user)) {
      alert('El usuario administrador principal "Alicia.Cleque" está protegido y debe permanecer activo.');
      return;
    }

    const nextStatus = user.estado === 'Activo' ? 'Inactivo' : 'Activo';
    const actionWord = nextStatus === 'Activo' ? 'reactivar' : 'desactivar';

    if (confirm(`¿Desea ${actionWord} al usuario "${user.nombre}"?`)) {
      onUpdateUser(user.id, { estado: nextStatus });
    }
  };

  const formatCreationDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('es-PE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6" id="modulo-usuarios">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-slate-800 text-2xl font-bold flex items-center gap-2">
            <Users className="text-fuchsia-600" />
            Apartado de Usuarios FDR
          </h2>
          <p className="text-slate-500 text-sm">
            Módulo exclusivo para Administradores. Registre, edite, suspenda y administre las credenciales de acceso.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all cursor-pointer"
        >
          <Plus className="w-4.5 h-4.5" />
          Crear Nuevo Usuario
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-card rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-4 justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Buscar por nombre, usuario, rol..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full glass-input text-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-hidden focus:ring-1 focus:ring-fuchsia-500"
          />
        </div>
        <div className="text-xs text-slate-400 font-medium">
          Mostrando {filteredUsers.length} usuarios registrados
        </div>
      </div>

      {/* Modern Responsive Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
              <tr>
                <th className="p-4">Nombre completo</th>
                <th className="p-4">Usuario</th>
                <th className="p-4">Credencial</th>
                <th className="p-4">Rol</th>
                <th className="p-4">Estado</th>
                <th className="p-4">Fecha de creación</th>
                <th className="p-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                    No se encontraron usuarios con los términos de búsqueda indicados.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const isMain = isMainAdmin(user);
                  return (
                    <tr key={user.id} className="hover:bg-slate-50/40 transition-colors">
                      {/* Name */}
                      <td className="p-4 font-bold text-slate-800">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                            user.rol === 'Administrador' ? 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100' :
                            user.rol === 'Analista' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                            user.rol === 'Reclutador' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                            user.rol === 'Formador' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                            user.rol === 'Coordinador' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
                            'bg-slate-50 text-slate-700 border border-slate-100'
                          }`}>
                            {user.nombre.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-slate-800 font-semibold">{user.nombre}</p>
                            {isMain && (
                              <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.2 rounded font-mono font-bold uppercase tracking-wider">
                                Principal
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Username */}
                      <td className="p-4 font-mono text-slate-500 font-semibold text-[11px]">
                        {user.usuario}
                      </td>

                      {/* Credential */}
                      <td className="p-4 text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{user.requiere_cambio_password ? 'Cambio requerido' : 'Activa'}</span>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase ${
                          user.rol === 'Administrador' ? 'bg-fuchsia-100 text-fuchsia-800' :
                          user.rol === 'Analista' ? 'bg-purple-100 text-purple-800' :
                          user.rol === 'Reclutador' ? 'bg-blue-100 text-blue-800' :
                          user.rol === 'Formador' ? 'bg-amber-100 text-amber-800' :
                          user.rol === 'Coordinador' ? 'bg-indigo-100 text-indigo-800' :
                          'bg-slate-100 text-slate-800'
                        }`}>
                          {user.rol}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase ${
                          user.estado === 'Activo' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${user.estado === 'Activo' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                          {user.estado}
                        </span>
                      </td>

                      {/* Creation Date */}
                      <td className="p-4 text-slate-500 font-medium">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatCreationDate(user.fecha_creacion)}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Edit button */}
                          <button
                            onClick={() => handleOpenEdit(user)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-all"
                            title="Editar usuario"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Reset Password button */}
                          <button
                            onClick={() => handleOpenPasswordModal(user)}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-slate-100 rounded-lg transition-all"
                            title="Cambiar contrasena temporal"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle active/inactive */}
                          <button
                            onClick={() => handleToggleStatus(user)}
                            disabled={isMain}
                            className={`p-1.5 rounded-lg transition-all ${
                              isMain ? 'text-slate-200 cursor-not-allowed' :
                              user.estado === 'Activo' ? 'text-slate-500 hover:text-rose-600 hover:bg-slate-100' : 'text-slate-500 hover:text-emerald-600 hover:bg-slate-100'
                            }`}
                            title={user.estado === 'Activo' ? 'Desactivar usuario' : 'Reactivar usuario'}
                          >
                            {user.estado === 'Activo' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>

                          {/* Delete button */}
                          <button
                            onClick={() => handleDeleteClick(user)}
                            disabled={isMain}
                            className={`p-1.5 rounded-lg transition-all ${
                              isMain ? 'text-slate-200 cursor-not-allowed' : 'text-slate-500 hover:text-rose-600 hover:bg-rose-100'
                            }`}
                            title="Eliminar usuario permanentemente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: CREATE OR EDIT USER DETAILS */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveUser}
            className="bg-white/95 backdrop-blur-md rounded-2xl p-6 max-w-3xl w-full max-h-[92vh] overflow-y-auto border border-slate-100 shadow-xl space-y-4 animate-in fade-in-50 animate-duration-200"
          >
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Shield className="text-fuchsia-600 w-5 h-5" />
                {editingId ? 'Editar Detalles de Usuario' : 'Registrar Nuevo Usuario'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-slate-700">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Carlos Peralta Alva"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-fuchsia-500 text-sm font-medium"
                  required
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 font-medium">
                El acceso se gestiona solo con usuario y contrasena.
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Correo de notificaciones</label>
                <input
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="nombre@empresa.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-fuchsia-500 text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Usuario de Acceso *</label>
                  <input
                    type="text"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                    placeholder="cperalta"
                    disabled={editingId !== null && usuario.toLowerCase() === 'alicia.cleque'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-fuchsia-500 text-sm font-medium disabled:opacity-55"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-600 mb-1">
                    {editingId ? 'Contrasena' : 'Contrasena Temporal *'}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editingId ? 'Use cambio temporal desde la accion de llave' : 'Minimo 6 caracteres'}
                    minLength={MIN_PASSWORD_LENGTH}
                    disabled={editingId !== null}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-fuchsia-500 text-sm font-medium disabled:opacity-55"
                    required={!editingId}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Rol Operativo *</label>
                  <select
                    value={rol}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    disabled={editingId !== null && usuario.toLowerCase() === 'alicia.cleque'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-fuchsia-500 text-sm font-semibold disabled:opacity-55"
                  >
                    <option value="Administrador">Administrador</option>
                    <option value="Analista">Analista</option>
                    <option value="Reclutador">Reclutador</option>
                    <option value="Formador">Formador</option>
                    <option value="Coordinador">Coordinador</option>
                    <option value="Sistemas">Sistemas</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-600 mb-1">Estado de Acceso *</label>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value as any)}
                    disabled={editingId !== null && usuario.toLowerCase() === 'alicia.cleque'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-fuchsia-500 text-sm font-semibold disabled:opacity-55"
                  >
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </select>
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/70 space-y-4">
                <div>
                  <p className="font-black text-slate-800 text-sm">Áreas de acceso</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {MULTI_AREA_ROLES.includes(rol)
                      ? 'Este cargo puede operar en más de un área.'
                      : 'Este cargo trabaja con un área principal a la vez.'}
                  </p>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  {AREA_OPTIONS.map((area) => {
                    const checked = areas.includes(area.id);
                    return (
                      <button
                        key={area.id}
                        type="button"
                        onClick={() => toggleArea(area.id)}
                        className={`text-left rounded-xl border p-3 transition ${
                          checked
                            ? 'border-indigo-300 bg-white shadow-xs ring-1 ring-indigo-100'
                            : 'border-slate-200 bg-white/70 hover:border-slate-300'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-xs font-black text-slate-800">
                          <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                            checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                          }`}>
                            {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </span>
                          {area.label}
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-1 leading-snug">{area.description}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-4">
                  {areas.map((area) => (
                    <div key={area} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <p className="text-xs font-black text-slate-800">
                          Apartados de {AREA_OPTIONS.find((item) => item.id === area)?.label}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const ids = MODULE_OPTIONS[area].map((item) => item.id);
                            const allSelected = ids.every((id) => moduleAccess.includes(id));
                            setModuleAccess((prev) =>
                              allSelected
                                ? prev.filter((id) => !ids.includes(id))
                                : [...new Set([...prev, ...ids])],
                            );
                          }}
                          className="text-[10px] font-black text-indigo-600 hover:text-indigo-800"
                        >
                          {MODULE_OPTIONS[area].every((item) => moduleAccess.includes(item.id)) ? 'Quitar todos' : 'Marcar todos'}
                        </button>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {MODULE_OPTIONS[area].map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600"
                          >
                            <input
                              type="checkbox"
                              checked={moduleAccess.includes(item.id)}
                              onChange={() => toggleModule(item.id)}
                              className="accent-indigo-600"
                            />
                            <span>{item.label}</span>
                            {moduleAccess.includes(item.id) && !item.id.endsWith(':reportes') && (
                              <select
                                value={moduleViewOnly.includes(item.id) ? 'view' : 'normal'}
                                onChange={(event) => setModuleViewOnly((prev) => event.target.value === 'view'
                                  ? [...new Set([...prev, item.id])]
                                  : prev.filter((id) => id !== item.id))}
                                aria-label={`Permiso para ${item.label}`}
                                className="ml-auto rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]"
                              >
                                <option value="normal">Normal</option>
                                <option value="view">Solo vista</option>
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs cursor-pointer transition-colors"
              >
                {isSaving ? 'Guardando...' : editingId ? 'Guardar Cambios' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: CHANGE PASSWORD DIRECTLY */}
      {showPasswordModal && passwordUserId && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePassword}
            className="bg-white/95 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-slate-100 shadow-xl space-y-4 animate-in fade-in-50 animate-duration-200"
          >
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Lock className="text-amber-500 w-5 h-5" />
                Cambiar Contraseña
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordUserId(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Establezca una nueva clave de acceso para el usuario{' '}
              <strong>{users.find(u => u.id === passwordUserId)?.nombre}</strong>.
            </p>

            <div className="space-y-3.5 text-xs text-slate-700">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Nueva Contraseña *</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Ingrese nueva contraseña"
                  minLength={MIN_PASSWORD_LENGTH}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-amber-500 text-sm font-medium"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Confirmar Nueva Contraseña *</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita nueva contraseña"
                  minLength={MIN_PASSWORD_LENGTH}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 outline-hidden focus:ring-1 focus:ring-amber-500 text-sm font-medium"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordUserId(null);
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs cursor-pointer transition-colors"
              >
                {isSaving ? 'Actualizando...' : 'Actualizar Clave'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: CONFIRM DELETE USER */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl p-6 max-w-md w-full border border-slate-100 shadow-xl space-y-4 animate-in fade-in-50 animate-duration-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Trash2 className="text-rose-600 w-5.5 h-5.5" />
                Eliminar Usuario FDR
              </h3>
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-slate-700">
              <p className="text-sm font-semibold text-slate-800 leading-relaxed">
                ¿Estás seguro de eliminar este usuario? Esta acción quitará su acceso a la plataforma.
              </p>
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-100 text-rose-800 font-medium space-y-1">
                <p><strong>Nombre completo:</strong> {userToDelete.nombre}</p>
                <p><strong>Usuario de acceso:</strong> {userToDelete.usuario}</p>
                <p><strong>Rol asignado:</strong> {userToDelete.rol}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteUser(userToDelete.id);
                  setUserToDelete(null);
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs cursor-pointer transition-colors"
              >
                Sí, eliminar usuario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
