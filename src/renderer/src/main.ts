import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { installScrollbarActivity } from './utils/scrollbarActivity';

installScrollbarActivity();
createApp(App).mount('#app');
