import Entypo from '@expo/vector-icons/Entypo'; // Behalten, wenn Entypo.font geladen wird
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Font from 'expo-font';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native'; // Importiert für den onLayoutRootView Wrapper

// Halten Sie den Begrüßungsbildschirm sichtbar, während wir Ressourcen abrufen
SplashScreen.preventAutoHideAsync();

// Optional: Legen Sie Animationsoptionen für den Begrüßungsbildschirm fest.
SplashScreen.setOptions({
  duration: 1000,
  fade: true,
});

export default function TabLayout() {
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Laden Sie hier Schriftarten vor und führen Sie alle erforderlichen API-Aufrufe durch
        await Font.loadAsync(Entypo.font); // Beispiel aus app.js
        // Möglicherweise möchten Sie auch Ionicons.font laden, falls erforderlich, z.B.:
        // await Font.loadAsync({ ...Ionicons.font });

        // Künstliche Verzögerung von zwei Sekunden, um eine langsame Ladeerfahrung zu simulieren.
        // Entfernen Sie dies, wenn Sie den Code kopieren und einfügen!
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.warn(e);
      } finally {
        // Teilen Sie der Anwendung mit, dass sie gerendert werden soll
        setAppIsReady(true);
      }
    }
    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      // Dies weist den Begrüßungsbildschirm an, sich sofort auszublenden!
      await SplashScreen.hideAsync(); // Verwenden Sie hideAsync für Konsistenz
    }
  }, [appIsReady]);

  if (!appIsReady) {
    return null; // Oder Ihre benutzerdefinierte Ladekomponente
  }

  // Wickeln Sie die Tabs in eine Ansicht, um onLayout anzuhängen.
  // Der ursprüngliche `app.js` gab eine Ansicht mit bestimmten Stilen zurück.
  // Hier verwenden wir nur einen einfachen View-Wrapper für onLayout.
  // Wenn Sie die Zentrierungsstile benötigen, wenden Sie sie auf diese Ansicht an.
  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#ffd33d',
          headerStyle: {
            backgroundColor: '#25292e',
          },
          headerShadowVisible: false,
          headerTintColor: '#fff',
          tabBarStyle: {
            backgroundColor: '#25292e',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'home-sharp' : 'home-outline'} color={color} size={24} />
            ),
          }}
        />
        <Tabs.Screen
          name="about"
          options={{
            title: 'About',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'information-circle' : 'information-circle-outline'} color={color} size={24}/>
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
// Die zusätzliche schließende Klammer } am Ende Ihrer ursprünglichen _layout.tsx wurde entfernt.