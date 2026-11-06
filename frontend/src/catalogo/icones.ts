// Catálogo de ícones (nomes do Lucide). Nome desconhecido vira um ícone genérico.
import type { Component } from 'vue';
import {
  Activity, Bell, Calendar, CalendarClock, CalendarPlus, Camera, CircleAlert, CircleHelp, ClipboardList, CreditCard, FileText, HeartPulse, House,
  LogOut, MessageCircle, PawPrint, Settings, Stethoscope, User, UserPlus, Users,
} from 'lucide-vue-next';

const ICONES: Record<string, Component> = {
  house: House, users: Users, user: User, 'user-plus': UserPlus, activity: Activity, 'heart-pulse': HeartPulse,
  'message-circle': MessageCircle, bell: Bell, settings: Settings, 'clipboard-list': ClipboardList, calendar: Calendar, 'calendar-clock': CalendarClock, 'calendar-plus': CalendarPlus,
  stethoscope: Stethoscope, 'paw-print': PawPrint, 'circle-alert': CircleAlert, 'file-text': FileText, camera: Camera,
  'credit-card': CreditCard, 'circle-help': CircleHelp, 'log-out': LogOut,
};
export const iconePorNome = (nome: string | undefined): Component => (nome && ICONES[nome]) || CircleHelp;
