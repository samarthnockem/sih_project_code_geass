import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { AssetModel } from "../models/asset.js";
import { FolderModel } from "../models/folder.js";

const aliceWallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bobWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

function authenticatedCookie(walletAddress = aliceWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function queryResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value)
    })
  };
}

function sortedQueryResult<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(value)
      })
    })
  };
}

function folderShape(options: { id?: mongoose.Types.ObjectId; ownerWallet?: string; name?: string } = {}) {
  return {
    _id: options.id ?? new mongoose.Types.ObjectId(),
    ownerWallet: options.ownerWallet ?? aliceWallet,
    name: options.name ?? "Demo Folder",
    parentFolderId: null,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z")
  };
}

describe("folders routes", () => {
  it("requires authentication", async () => {
    const findSpy = vi.spyOn(FolderModel, "find");
    const createSpy = vi.spyOn(FolderModel, "create");
    const findOneSpy = vi.spyOn(FolderModel, "findOne");
    const deleteSpy = vi.spyOn(FolderModel, "deleteOne");

    await request(createApp()).get("/api/folders").expect(401);
    await request(createApp()).post("/api/folders").send({ name: "Legal" }).expect(401);
    await request(createApp()).get(`/api/folders/${new mongoose.Types.ObjectId().toString()}`).expect(401);
    await request(createApp()).delete(`/api/folders/${new mongoose.Types.ObjectId().toString()}`).expect(401);

    expect(findSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("lists only folders owned by the authenticated wallet", async () => {
    const aliceFolder = folderShape({ name: "Alice Docs" });
    const findSpy = vi.spyOn(FolderModel, "find").mockReturnValue(sortedQueryResult([aliceFolder]) as never);

    const response = await request(createApp()).get("/api/folders").set("Cookie", authenticatedCookie()).expect(200);

    expect(findSpy).toHaveBeenCalledWith({ ownerWallet: aliceWallet });
    expect(response.body.folders).toEqual([
      {
        id: aliceFolder._id.toString(),
        ownerWallet: aliceWallet,
        name: "Alice Docs",
        parentFolderId: null,
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z"
      }
    ]);
  });

  it("creates a folder for the authenticated wallet and rejects owner spoofing", async () => {
    const folder = folderShape({ name: "Vault" });
    const createSpy = vi.spyOn(FolderModel, "create").mockResolvedValue(folder as never);

    const response = await request(createApp())
      .post("/api/folders")
      .set("Cookie", authenticatedCookie())
      .send({ name: " Vault " })
      .expect(201);

    expect(createSpy).toHaveBeenCalledWith({
      ownerWallet: aliceWallet,
      name: "Vault",
      parentFolderId: null
    });
    expect(response.body.folder.id).toBe(folder._id.toString());
    expect(response.body.folder.ownerWallet).toBe(aliceWallet);

    await request(createApp())
      .post("/api/folders")
      .set("Cookie", authenticatedCookie())
      .send({ name: "Vault", ownerWallet: bobWallet })
      .expect(400);
  });

  it("does not allow another user's folder as a parent folder", async () => {
    const parentFolderId = new mongoose.Types.ObjectId().toString();
    const findOneSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);
    const createSpy = vi.spyOn(FolderModel, "create");

    const response = await request(createApp())
      .post("/api/folders")
      .set("Cookie", authenticatedCookie())
      .send({ name: "Child", parentFolderId })
      .expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(findOneSpy).toHaveBeenCalledWith({ _id: parentFolderId, ownerWallet: aliceWallet });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("validates folder names and ids", async () => {
    const createSpy = vi.spyOn(FolderModel, "create");
    const findOneSpy = vi.spyOn(FolderModel, "findOne");

    await request(createApp()).post("/api/folders").set("Cookie", authenticatedCookie()).send({ name: "" }).expect(400);
    await request(createApp())
      .post("/api/folders")
      .set("Cookie", authenticatedCookie())
      .send({ name: "../secret" })
      .expect(400);
    await request(createApp()).get("/api/folders/not-an-object-id").set("Cookie", authenticatedCookie()).expect(400);

    expect(createSpy).not.toHaveBeenCalled();
    expect(findOneSpy).not.toHaveBeenCalled();
  });

  it("does not allow a folder id to read another user's folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const findOneSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);

    const response = await request(createApp()).get(`/api/folders/${folderId}`).set("Cookie", authenticatedCookie()).expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(findOneSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet: aliceWallet });
  });

  it("returns an owned folder by id", async () => {
    const folder = folderShape({ name: "Owned" });
    const findOneSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(folder) as never);

    const response = await request(createApp())
      .get(`/api/folders/${folder._id.toString()}`)
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(findOneSpy).toHaveBeenCalledWith({ _id: folder._id.toString(), ownerWallet: aliceWallet });
    expect(response.body.folder).toMatchObject({
      id: folder._id.toString(),
      ownerWallet: aliceWallet,
      name: "Owned"
    });
  });

  it("does not allow a folder id to delete another user's folder", async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    const findOneSpy = vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult(null) as never);
    const countSpy = vi.spyOn(AssetModel, "countDocuments");
    const deleteSpy = vi.spyOn(FolderModel, "deleteOne");

    const response = await request(createApp())
      .delete(`/api/folders/${folderId}`)
      .set("Cookie", authenticatedCookie())
      .expect(404);

    expect(response.body.error.code).toBe("FOLDER_NOT_FOUND");
    expect(findOneSpy).toHaveBeenCalledWith({ _id: folderId, ownerWallet: aliceWallet });
    expect(countSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("rejects deleting a folder that contains owned assets", async () => {
    const folder = folderShape();
    vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: folder._id }) as never);
    const countSpy = vi.spyOn(AssetModel, "countDocuments").mockResolvedValue(1 as never);
    const deleteSpy = vi.spyOn(FolderModel, "deleteOne");

    const response = await request(createApp())
      .delete(`/api/folders/${folder._id.toString()}`)
      .set("Cookie", authenticatedCookie())
      .expect(409);

    expect(response.body.error).toEqual({
      code: "FOLDER_NOT_EMPTY",
      message: "Folder contains assets; move assets to Unfiled before deleting the folder"
    });
    expect(countSpy).toHaveBeenCalledWith({ ownerWallet: aliceWallet, folderId: folder._id.toString() });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("deletes an owned empty folder without touching assets or blockchain state", async () => {
    const folder = folderShape();
    vi.spyOn(FolderModel, "findOne").mockReturnValue(queryResult({ _id: folder._id }) as never);
    vi.spyOn(AssetModel, "countDocuments").mockResolvedValue(0 as never);
    const deleteSpy = vi.spyOn(FolderModel, "deleteOne").mockResolvedValue({ deletedCount: 1 } as never);

    await request(createApp())
      .delete(`/api/folders/${folder._id.toString()}`)
      .set("Cookie", authenticatedCookie())
      .expect(204);

    expect(deleteSpy).toHaveBeenCalledWith({ _id: folder._id.toString(), ownerWallet: aliceWallet });
  });
});
