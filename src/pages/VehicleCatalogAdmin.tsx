import { useEffect, useMemo, useState } from "react";
import {
  getVehicleCatalogForManagement,
  getVehicleCatalogUpdatedEventName,
  removeVehicleManufacturer,
  removeVehicleModel,
  removeVehicleSubmodel,
  renameVehicleManufacturer,
  renameVehicleModel,
  renameVehicleSubmodel,
  saveVehicleCatalogEntry,
} from "../utils/vehicleCatalog";
import { useLanguage } from "../i18n/LanguageContext";
import "./VehicleCatalogAdmin.css";

type CatalogMap = Record<string, Record<string, string[]>>;

function normalize(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export default function VehicleCatalogAdmin() {
  const { t } = useLanguage();
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [subModel, setSubModel] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [editingManufacturer, setEditingManufacturer] = useState<{ original: string; value: string } | null>(null);
  const [editingModel, setEditingModel] = useState<{ manufacturer: string; original: string; value: string } | null>(null);
  const [editingSubmodel, setEditingSubmodel] = useState<{
    manufacturer: string;
    model: string;
    original: string;
    value: string;
  } | null>(null);

  useEffect(() => {
    const eventName = getVehicleCatalogUpdatedEventName();
    const onCatalogChanged = () => setCatalogVersion((v) => v + 1);
    window.addEventListener(eventName, onCatalogChanged);
    return () => window.removeEventListener(eventName, onCatalogChanged);
  }, []);

  const catalog = useMemo<CatalogMap>(() => getVehicleCatalogForManagement(), [catalogVersion]);
  const manufacturers = useMemo(() => Object.keys(catalog).sort((a, b) => a.localeCompare(b)), [catalog]);

  const handleAdd = () => {
    const mfr = normalize(manufacturer);
    const mdl = normalize(model);
    const sub = normalize(subModel);
    if (!mfr || !mdl) return;

    saveVehicleCatalogEntry(mfr, mdl, sub || undefined);
    setManufacturer("");
    setModel("");
    setSubModel("");
  };

  const saveManufacturerEdit = () => {
    if (!editingManufacturer) return;
    const next = normalize(editingManufacturer.value);
    if (next) renameVehicleManufacturer(editingManufacturer.original, next);
    setEditingManufacturer(null);
  };

  const saveModelEdit = () => {
    if (!editingModel) return;
    const next = normalize(editingModel.value);
    if (next) renameVehicleModel(editingModel.manufacturer, editingModel.original, next);
    setEditingModel(null);
  };

  const saveSubmodelEdit = () => {
    if (!editingSubmodel) return;
    const next = normalize(editingSubmodel.value);
    if (next) {
      renameVehicleSubmodel(
        editingSubmodel.manufacturer,
        editingSubmodel.model,
        editingSubmodel.original,
        next
      );
    }
    setEditingSubmodel(null);
  };

  return (
    <div className="vca-page">
      <header className="vca-header">
        <div>
          <h1>{t("Add Vehicles")}</h1>
          <p>{t("Manage manufacturer, model, and sub-model options used by Job Cards.")}</p>
        </div>
      </header>

      <section className="vca-form-card">
        <h2>{t("Add or Update Vehicle Catalog")}</h2>
        <div className="vca-form-grid">
          <label>
            <span>{t("Manufacturer")}</span>
            <input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder={t("e.g. Toyota") as string}
              data-no-translate="true"
            />
          </label>
          <label>
            <span>{t("Model")}</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("e.g. Land Cruiser") as string}
              data-no-translate="true"
            />
          </label>
          <label>
            <span>{t("Sub-Model (Optional)")}</span>
            <input
              value={subModel}
              onChange={(e) => setSubModel(e.target.value)}
              placeholder={t("e.g. GR Sport") as string}
              data-no-translate="true"
            />
          </label>
        </div>

        <div className="vca-form-actions">
          <button type="button" onClick={handleAdd} disabled={!normalize(manufacturer) || !normalize(model)}>
            {t("Save Vehicle Entry")}
          </button>
        </div>
      </section>

      <section className="vca-list-card">
        <h2>{t("Vehicle Catalog")}</h2>
        {manufacturers.length === 0 ? (
          <div className="vca-empty">{t("No manufacturers found.")}</div>
        ) : (
          <div className="vca-manufacturer-list">
            {manufacturers.map((mfr) => {
              const models = Object.keys(catalog[mfr] || {}).sort((a, b) => a.localeCompare(b));
              const isEditingManufacturer = editingManufacturer?.original === mfr;

              return (
                <article key={mfr} className="vca-manufacturer-item">
                  <div className="vca-manufacturer-head">
                    {isEditingManufacturer ? (
                      <div className="vca-inline-edit">
                        <input
                          value={editingManufacturer.value}
                          onChange={(e) => setEditingManufacturer({ original: mfr, value: e.target.value })}
                          data-no-translate="true"
                        />
                        <button type="button" onClick={saveManufacturerEdit} disabled={!normalize(editingManufacturer.value)}>
                          {t("Save")}
                        </button>
                        <button type="button" className="ghost" onClick={() => setEditingManufacturer(null)}>
                          {t("Cancel")}
                        </button>
                      </div>
                    ) : (
                      <h3 data-no-translate="true">{mfr}</h3>
                    )}

                    <div className="vca-row-actions">
                      {!isEditingManufacturer && (
                        <button type="button" onClick={() => setEditingManufacturer({ original: mfr, value: mfr })}>
                          {t("Edit")}
                        </button>
                      )}
                      <button type="button" className="danger" onClick={() => removeVehicleManufacturer(mfr)}>
                        {t("Delete Manufacturer")}
                      </button>
                    </div>
                  </div>

                  {models.map((mdl) => {
                    const submodels = (catalog[mfr]?.[mdl] || []).slice().sort((a, b) => a.localeCompare(b));
                    const isEditingModel = editingModel?.manufacturer === mfr && editingModel?.original === mdl;

                    return (
                      <div key={`${mfr}-${mdl}`} className="vca-model-item">
                        <div className="vca-model-head">
                          {isEditingModel ? (
                            <div className="vca-inline-edit">
                              <input
                                value={editingModel.value}
                                onChange={(e) =>
                                  setEditingModel({ manufacturer: mfr, original: mdl, value: e.target.value })
                                }
                                data-no-translate="true"
                              />
                              <button type="button" onClick={saveModelEdit} disabled={!normalize(editingModel.value)}>
                                {t("Save")}
                              </button>
                              <button type="button" className="ghost" onClick={() => setEditingModel(null)}>
                                {t("Cancel")}
                              </button>
                            </div>
                          ) : (
                            <strong data-no-translate="true">{mdl}</strong>
                          )}

                          <div className="vca-row-actions">
                            {!isEditingModel && (
                              <button type="button" onClick={() => setEditingModel({ manufacturer: mfr, original: mdl, value: mdl })}>
                                {t("Edit")}
                              </button>
                            )}
                            <button type="button" className="danger" onClick={() => removeVehicleModel(mfr, mdl)}>
                              {t("Delete Model")}
                            </button>
                          </div>
                        </div>

                        {submodels.length > 0 ? (
                          <div className="vca-submodels">
                            {submodels.map((sub) => {
                              const isEditingSubmodel =
                                editingSubmodel?.manufacturer === mfr &&
                                editingSubmodel?.model === mdl &&
                                editingSubmodel?.original === sub;

                              if (isEditingSubmodel) {
                                return (
                                  <span key={`${mfr}-${mdl}-${sub}`} className="vca-submodel-chip is-editing">
                                    <input
                                      value={editingSubmodel.value}
                                      onChange={(e) =>
                                        setEditingSubmodel({
                                          manufacturer: mfr,
                                          model: mdl,
                                          original: sub,
                                          value: e.target.value,
                                        })
                                      }
                                      data-no-translate="true"
                                    />
                                    <button type="button" onClick={saveSubmodelEdit} disabled={!normalize(editingSubmodel.value)}>
                                      {t("Save")}
                                    </button>
                                    <button type="button" onClick={() => setEditingSubmodel(null)}>
                                      {t("Cancel")}
                                    </button>
                                  </span>
                                );
                              }

                              return (
                                <span key={`${mfr}-${mdl}-${sub}`} className="vca-submodel-chip" data-no-translate="true">
                                  {sub}
                                  <button
                                    type="button"
                                    aria-label={t("Edit sub-model") as string}
                                    onClick={() => setEditingSubmodel({ manufacturer: mfr, model: mdl, original: sub, value: sub })}
                                  >
                                    {t("Edit")}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={t("Delete sub-model") as string}
                                    onClick={() => removeVehicleSubmodel(mfr, mdl, sub)}
                                  >
                                    x
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="vca-empty-inline">{t("No sub-models")}</div>
                        )}
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
