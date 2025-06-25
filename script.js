// Конфигурация
    const CONFIG = {
      spreadsheetId: '18CV2mGHXk28i6YrXK5R1CaH3BaQHOA45qwi1r07NkzI',
      sheetName: 'Потребность готовый',
      defaultCenter: [55.751244, 37.618423] // Москва
    };

    let map;
    let markers = [];
    const geocodeCache = new Map(); // Кеш геокодирования

    // Инициализация приложения
    async function initApp() {
      showLoading('Загрузка карты...');
      
      // 1. Инициализация карты 2GIS
      await init2GISMap();

      // 2. Загрузка данных из Google Sheets
      showLoading('Загрузка данных...');
      let sheetData;
      try {
        sheetData = await loadSheetData();
      } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        showError('Не удалось загрузить данные из таблицы');
        return;
      }

      // 3. Обработка и геокодирование адресов
      showLoading('Обработка адресов...');
      const locations = processSheetData(sheetData);
      await addMarkersToMap(locations);

      hideLoading();
    }

    // Инициализация карты 2GIS
    function init2GISMap() {
      return new Promise((resolve) => {
        DG.then(() => {
          map = DG.map('map', {
            center: CONFIG.defaultCenter,
            zoom: 12
          });
          DG.control.location({ position: 'topright' }).addTo(map);
          resolve();
        });
      });
    }

    // Загрузка данных из Google Sheets (ваш текущий метод)
    async function loadSheetData() {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?tqx=responseHandler:handleGSData&sheet=${CONFIG.sheetName}`;
        document.head.appendChild(script);

        window.handleGSData = (data) => {
          document.head.removeChild(script);
          delete window.handleGSData;

          if (!data.table || !data.table.rows) {
            reject(new Error('Некорректный формат данных'));
            return;
          }

          const result = [];
          const cols = data.table.cols.map(col => col.label);
          result.push(cols);

          data.table.rows.forEach(row => {
            const values = row.c.map(cell => cell?.v || '');
            result.push(values);
          });

          resolve(result);
        };

        script.onerror = () => {
          reject(new Error('Не удалось загрузить данные'));
        };
      });
    }

    // Обработка данных таблицы (аналогично вашему коду)
    function processSheetData(rows) {
      const headers = rows[0].map(h => h.toString().trim());
      const numberIndex = headers.findIndex(h => h.match('ТК'));
      const addressIndex = headers.findIndex(h => h.match('Адрес'));
      const positionIndex = headers.findIndex(h => h.match('Должность'));
      const countIndex = headers.findIndex(h => h.match('Сколько нужно людей'));
      const cashIndex = headers.findIndex(h => h.match('Тариф'));

      if (addressIndex === -1 || positionIndex === -1 || countIndex === -1 || cashIndex === -1) {
        throw new Error('Не найдены необходимые столбцы в таблице');
      }

      const locationMap = new Map();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < Math.max(numberIndex, addressIndex, positionIndex, countIndex, cashIndex)) continue;

        const number = parseInt(row[numberIndex]) || 0;
        const address = row[addressIndex]?.toString().trim();
        const position = row[positionIndex]?.toString().trim();
        const count = parseInt(row[countIndex]) || 0;
        const cash = parseInt(row[cashIndex]) || 0;

        if (!address || !position) continue;

        if (!locationMap.has(address)) {
          locationMap.set(address, {
            address: address,
            positions: new Map()
          });
        }
        
        locationMap.get(address).positions.set(position, {
          count: (locationMap.get(address).positions.get(position)?.count || 0) + count,
          number: number,
          cash: cash
        });
      }

      return Array.from(locationMap.values());
    }

    // Геокодирование через Яндекс + кеширование
    async function geocodeWithYandex(address) {
      if (geocodeCache.has(address)) {
        return geocodeCache.get(address);
      }

      return new Promise((resolve) => {
        ymaps.geocode(address, { results: 1 }).then((res) => {
          const firstResult = res.geoObjects.get(0);
          if (firstResult) {
            const coords = firstResult.geometry.getCoordinates();
            geocodeCache.set(address, coords);
            resolve(coords);
          } else {
            resolve(null);
          }
        });
      });
    }

    // Добавление маркеров на карту 2GIS
    async function addMarkersToMap(locations) {
      let successCount = 0;

      for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        try {
          showLoading(`Загрузка объектов: ${i+1} из ${locations.length}...`);

          // 1. Пытаемся найти точный адрес
          let coords = await geocodeWithYandex(location.address);

          // 2. Fallback: если адрес не найден, ищем только улицу
          if (!coords) {
            const streetQuery = location.address.split(/,\s*\d+/)[0];
            coords = await geocodeWithYandex(streetQuery);
            if (coords) {
              location.address += ' (примерное расположение)';
            }
          }

          if (coords) {
            const marker = createMarker(coords, location);
            marker.addTo(map);
            markers.push(marker);
            successCount++;
          } else {
            console.warn('Не удалось геокодировать:', location.address);
          }
        } catch (error) {
          console.error('Ошибка:', error);
        }
      }

      if (successCount > 0 && markers.length > 0) {
        const group = DG.featureGroup(markers);
        map.fitBounds(group.getBounds());
      } else {
        showError('Не удалось добавить ни одного маркера');
      }
    }

    // Создание маркера для 2GIS
    function createMarker(coords, location) {
      const firstTKNumber = Array.from(location.positions.values())[0]?.number || '';
      
      const popupContent = `
        <div class="dg-popup">
          <div class="balloon-title">ТК ${firstTKNumber} ${location.address}</div>
          ${Array.from(location.positions.entries()).map(([position, data]) => `
            <div class="position-item">
              <strong>${position}</strong><br>
              Требуется сотрудников: ${data.count}<br>
              Тариф: ${data.cash} руб.
            </div>
          `).join('')}
        </div>
      `;

      return DG.marker(coords, {
        icon: DG.icon({
          iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="%23007bff"><path d="M16 0C10.5 0 6 4.5 6 10c0 7 10 22 10 22s10-15 10-22c0-5.5-4.5-10-10-10zm0 15c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5z"/></svg>',
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        })
      }).bindPopup(popupContent);
    }

    // Вспомогательные функции
    function showLoading(message) {
      const loadingDiv = document.getElementById('loading');
      if (loadingDiv) {
        loadingDiv.textContent = message;
        loadingDiv.style.display = 'block';
      }
    }

    function hideLoading() {
      const loadingDiv = document.getElementById('loading');
      if (loadingDiv) {
        loadingDiv.style.display = 'none';
      }
    }

    function showError(message) {
      console.error(message);
      alert(message);
    }

    // Запуск при загрузке страницы
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof DG === 'undefined' || typeof ymaps === 'undefined') {
        showError('Не загружены API карт. Обновите страницу.');
        return;
      }
      initApp();
    });