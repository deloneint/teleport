
// Конфигурация
const CONFIG = {
    spreadsheetId: '18CV2mGHXk28i6YrXK5R1CaH3BaQHOA45qwi1r07NkzI',
    sheetName: 'Потребность готовый',
    defaultCenter: [55.751244, 37.618423]
};

let map;
let userLocation = null;

// Основная функция инициализации
async function initApp() {
    try {
        showLoading('Инициализация карты...');

        // Инициализация карты
        await initMap();

        // Загрузка данных (пробуем разные методы)
        showLoading('Загрузка данных из таблицы...');
        let sheetData;

        try {
            sheetData = await tryOfficialGoogleAPI();
        } catch (e1) {
            console.warn('Официальный API не сработал:', e1);
            try {
                sheetData = await tryAlternativeMethod();
            } catch (e2) {
                console.warn('Альтернативный метод не сработал:', e2);
                throw new Error('Не удалось загрузить данные. Проверьте доступ к таблице.');
            }
        }

        // Обработка данных
        showLoading('Обработка данных...');
        const locations = processSheetData(sheetData);

        // Добавление меток
        showLoading('Геокодирование адресов...');
        await addPlacemarksToMap(locations);

        hideLoading();

    } catch (error) {
        console.error('Ошибка:', error);
        showError(error.message);
    }
}

// Пробуем официальный Google Sheets API
async function tryOfficialGoogleAPI() {
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.spreadsheetId}/values/${CONFIG.sheetName}?key=AIzaSyC_rmF62rjOewGHcOKb_lBIZ86wK45bhZ8`;
    const response = await fetch(url);

    if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error?.message || 'Ошибка доступа к Google API');
    }

    const data = await response.json();
    return data.values || [];
}

// Альтернативный метод через JSONP
async function tryAlternativeMethod() {
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
            document.head.removeChild(script);
            reject(new Error('Не удалось загрузить данные'));
        };
    });
}

// Инициализация карты
async function initMap() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            createMap(CONFIG.defaultCenter);
            return resolve();
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                createMap([position.coords.latitude, position.coords.longitude]);
                resolve();
            },
            error => {
                console.warn('Геолокация недоступна:', error);
                createMap(CONFIG.defaultCenter);
                resolve();
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

function createMap(center) {
    map = new ymaps.Map('map', {
        center: center,
        zoom: 12,
        controls: ['zoomControl']
    });

    // Добавляем кнопку "Мое местоположение"
    addMyLocationButton();
}
// Обработка данных таблицы
function processSheetData(rows) {
    try {
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

            if (isNaN(number) || !address || !position || isNaN(count) || isNaN(cash)) continue;

            if (!locationMap.has(address)) {
                locationMap.set(address, {
                    address: address,
                    positions: new Map()
                });
            }
            // Сохраняем и количество, и тариф
            locationMap.get(address).positions.set(position, {
                count: (locationMap.get(address).positions.get(position)?.count || 0) + count,
                number: number,
                cash: cash // Если тарифы могут различаться, нужно определить логику объединения
            });
        }

        return Array.from(locationMap.values());

    } catch (error) {
        console.error('Ошибка обработки данных:', error);
        throw new Error(`Ошибка обработки таблицы: ${error.message}`);
    }
}

// Добавление меток на карту
async function addPlacemarksToMap(locations) {
    try {
        if (!locations || locations.length === 0) {
            throw new Error('Нет данных для отображения');
        }

        const geoObjects = new ymaps.GeoObjectCollection();
        let successCount = 0;

        for (let i = 0; i < locations.length; i++) {
            const location = locations[i];
            try {
                showLoading(`Загрузка объектов ${i + 1} из ${locations.length}...`);

                await new Promise(resolve => setTimeout(resolve, 0.1));

                const geocodeResult = await ymaps.geocode(location.address, { results: 1 });
                const firstGeoObject = geocodeResult.geoObjects.get(0);

                if (firstGeoObject) {
                    const placemark = createPlacemark(firstGeoObject, location);
                    geoObjects.add(placemark);
                    successCount++;
                }
            } catch (error) {
                console.warn(`Ошибка геокодирования "${location.address}":`, error);
            }
        }

        if (successCount > 0) {
            map.geoObjects.add(geoObjects);
            try {
                const bounds = geoObjects.getBounds();
                if (bounds) map.setBounds(bounds, { checkZoomRange: true });
            } catch (e) {
                console.warn('Ошибка масштабирования:', e);
            }
        } else {
            throw new Error('Не удалось геокодировать ни один адрес');
        }

    } catch (error) {
        console.error('Ошибка добавления меток:', error);
        throw error;
    }
}

// Создание метки
function createPlacemark(geoObject, location) {
    const coords = geoObject.geometry.getCoordinates();

    // Получаем первый номер ТК для этого адреса (все номера для одного адреса одинаковы)
    const firstTKNumber = Array.from(location.positions.values())[0]?.number || '';

    let balloonContent = `
                <div class="balloon-content">
                    <div class="balloon-title">ТК ${firstTKNumber} ${location.address}</div>`;

    location.positions.forEach((data, position) => {
        balloonContent += `
                    <div class="position-item">
                        <strong>${position}</strong><br>
                        Требуется сотрудников: ${data.count}
                        <br>
                        Тариф: ${data.cash} руб.
                    </div>`;
    });

    balloonContent += `</div>`;

    return new ymaps.Placemark(
        coords,
        { balloonContent: balloonContent },
        {
            preset: 'islands#blackIcon',
            balloonCloseButton: true,
            hideIconOnBalloonOpen: false
        }
    );
}

// Добавление кнопки "Мое местоположение"
function addMyLocationButton() {
    const button = document.createElement('div');
    button.className = 'my-location-btn';
    button.title = 'Мое местоположение';

    const icon = document.createElement('div');
    icon.className = 'my-location-icon';
    button.appendChild(icon);

    map.container.getElement().parentNode.appendChild(button);

    button.addEventListener('click', () => {
        if (!userLocation) {
            getCurrentLocation();
        } else {
            centerMapToUserLocation();
        }
    });
}

// Центрирование карты на местоположении пользователя
function centerMapToUserLocation() {
    if (userLocation) {
        map.setCenter(userLocation, 15, {
            duration: 500
        });

        // Добавляем временную метку
        if (map.myLocationPlacemark) {
            map.geoObjects.remove(map.myLocationPlacemark);
        }

        map.myLocationPlacemark = new ymaps.Placemark(
            userLocation,
            { balloonContent: 'Вы здесь' },
            {
                preset: 'islands#circleDotIcon',
                iconColor: 'black'
            }
        );

        map.geoObjects.add(map.myLocationPlacemark);

        // Удаляем метку через 5 секунд
        setTimeout(() => {
            if (map.myLocationPlacemark) {
                map.myLocationPlacemark = null;
            }
        }, 5000);
    } else {
        getCurrentLocation();
    }
}

// Получение текущего местоположения
function getCurrentLocation() {
    showLoading('Определение местоположения...');

    if (!navigator.geolocation) {
        showError('Геолокация не поддерживается вашим браузером');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {
            userLocation = [position.coords.latitude, position.coords.longitude];
            centerMapToUserLocation();
            hideLoading();
        },
        error => {
            console.warn('Ошибка геолокации:', error);
            showError('Не удалось определить местоположение');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}



// Вспомогательные функции интерфейса
function showLoading(message) {
    document.getElementById('loading').firstElementChild.textContent = message;
    document.getElementById('error').textContent = '';
    document.getElementById('loading').style.display = 'flex';
}

function showError(message) {
    document.getElementById('error').textContent = message;
    document.getElementById('loading').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', initApp);
