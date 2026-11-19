import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import term from '../src/terminal-colors.json';

export default function Layout() {
  // Light status bar icons stay visible on the dark terminal background in both system themes.
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: term.bg } }} />
    </>
  );
}
